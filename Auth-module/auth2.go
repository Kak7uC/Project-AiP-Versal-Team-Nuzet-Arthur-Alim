package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	GITHUB_CLIENT_ID     = "Ov23liUMaPN9HYOlJgG5"
	GITHUB_CLIENT_SECRET = "bff8dad9835cb475c10b1819870899e3fcb340eb"
	GITHUB_CALLBACK_URL  = "http://localhost:8080/oauth/github"

	YANDEX_CLIENT_ID     = "f085c61ba55c469aa0ea68b85f873e4e"
	YANDEX_CLIENT_SECRET = "bd07d0de73d24a8395d297b0a1796ea0"
	YANDEX_CALLBACK_URL  = "http://localhost:8080/oauth/yandex"

	MONGODB_URI = "mongodb+srv://kew:samsungty@kewww.1zxx45h.mongodb.net/?appName=kewww"
	JWT_SECRET  = "your-secret-key-change-this"
)

// ==================== ИЗМЕНЕННЫЕ СТРУКТУРЫ ====================

type LoginToken struct {
	CreatedAt    time.Time
	Status       string // "pending", "granted", "denied"
	UserID       string
	AccessToken  string // JWT на 1 минуту
	RefreshToken string // JWT на 7 дней
}

type AuthState struct {
	loginTokens map[string]LoginToken // Храним токены входа (5 минут)
	tokensMutex sync.RWMutex
	IsDone      bool
	Code        string
	Type        string // "github" или "yandex"
	mu          sync.RWMutex
}

type GitHubUserData struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
	Email string `json:"email"`
}

type YandexUserData struct {
	ID           string `json:"id"`
	Login        string `json:"login"`
	DefaultEmail string `json:"default_email"`
	Access       string `json:"access"`
}

type AuthModule struct {
	authState   AuthState
	mongoClient *mongo.Client
}

func NewAuthModule() *AuthModule {
	return &AuthModule{
		authState: AuthState{
			loginTokens: make(map[string]LoginToken),
		},
	}
}

// ==================== JWT ФУНКЦИИ ====================

func createAccessToken(userID, login string) string {
	claims := jwt.MapClaims{
		"user_id": userID,
		"login":   login,
		"exp":     time.Now().Add(1 * time.Minute).Unix(),
		"type":    "access",
	}
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(JWT_SECRET))
	return token
}

func createRefreshToken(userID, login string) string {
	claims := jwt.MapClaims{
		"user_id": userID,
		"login":   login,
		"exp":     time.Now().Add(7 * 24 * time.Hour).Unix(),
		"type":    "refresh",
	}
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(JWT_SECRET))
	return token
}

// ==================== ОБНОВЛЕННЫЙ СЕРВЕР ====================

func (am *AuthModule) StartAuthServer() {
	// Эндпоинты ТЗ
	http.HandleFunc("/api/auth/init", am.handleInitAuth)
	http.HandleFunc("/api/auth/check/", am.handleCheckAuth)
	http.HandleFunc("/api/auth/refresh", am.handleRefreshToken)
	http.HandleFunc("/api/auth/logout", am.handleLogout)

	// Существующие OAuth эндпоинты
	http.HandleFunc("/oauth/github", am.handleGitHubOauth)
	http.HandleFunc("/oauth/yandex", am.handleYandexOauth)

	// Существующие эндпоинты
	http.HandleFunc("/api/auth/status", am.handleAuthStatus)
	http.HandleFunc("/api/auth/url", am.handleAuthURL)

	// Очистка старых токенов каждую минуту
	go func() {
		ticker := time.NewTicker(time.Minute)
		for range ticker.C {
			am.authState.tokensMutex.Lock()
			for token, state := range am.authState.loginTokens {
				if time.Since(state.CreatedAt) > 5*time.Minute {
					delete(am.authState.loginTokens, token)
				}
			}
			am.authState.tokensMutex.Unlock()
		}
	}()

	log.Println("Сервер авторизации запущен на порту 8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Ошибка запуска сервера: %v", err)
	}
}

// ==================== ЭНДПОИНТЫ ТЗ ====================

// GET /api/auth/init?type=github&login_token=abc123
func (am *AuthModule) handleInitAuth(w http.ResponseWriter, r *http.Request) {
	authType := r.URL.Query().Get("type")
	loginToken := r.URL.Query().Get("login_token")

	if loginToken == "" {
		http.Error(w, "Нужен login_token", http.StatusBadRequest)
		return
	}

	// Сохраняем токен входа на 5 минут
	am.authState.tokensMutex.Lock()
	am.authState.loginTokens[loginToken] = LoginToken{
		CreatedAt: time.Now(),
		Status:    "pending",
	}
	am.authState.tokensMutex.Unlock()

	var authURL string
	if authType == "yandex" {
		authURL = fmt.Sprintf(
			"https://oauth.yandex.ru/authorize?response_type=code&client_id=%s&redirect_uri=%s&state=%s",
			YANDEX_CLIENT_ID,
			url.QueryEscape(YANDEX_CALLBACK_URL),
			loginToken,
		)
	} else {
		authURL = fmt.Sprintf(
			"https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&state=%s&scope=user",
			GITHUB_CLIENT_ID,
			url.QueryEscape(GITHUB_CALLBACK_URL),
			loginToken,
		)
	}

	response := map[string]string{
		"auth_url": authURL,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GET /api/auth/check/{login_token}
func (am *AuthModule) handleCheckAuth(w http.ResponseWriter, r *http.Request) {
	// Извлекаем токен из URL: /api/auth/check/abc123
	pathParts := strings.Split(r.URL.Path, "/")
	if len(pathParts) < 4 {
		http.Error(w, "Неверный URL", http.StatusBadRequest)
		return
	}
	loginToken := pathParts[3]

	am.authState.tokensMutex.RLock()
	state, exists := am.authState.loginTokens[loginToken]
	am.authState.tokensMutex.RUnlock()

	// Проверяем таймаут 5 минут
	if !exists || time.Since(state.CreatedAt) > 5*time.Minute {
		if exists {
			am.authState.tokensMutex.Lock()
			delete(am.authState.loginTokens, loginToken)
			am.authState.tokensMutex.Unlock()
		}
		http.Error(w, "Токен устарел", http.StatusGone)
		return
	}

	response := map[string]string{"status": state.Status}
	if state.Status == "granted" {
		response["access_token"] = state.AccessToken
		response["refresh_token"] = state.RefreshToken
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// POST /api/auth/refresh
func (am *AuthModule) handleRefreshToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Неверный запрос", http.StatusBadRequest)
		return
	}

	// Проверяем refresh token
	token, err := jwt.Parse(req.RefreshToken, func(t *jwt.Token) (interface{}, error) {
		return []byte(JWT_SECRET), nil
	})

	if err != nil || !token.Valid {
		http.Error(w, "Невалидный refresh token", http.StatusUnauthorized)
		return
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || claims["type"] != "refresh" {
		http.Error(w, "Неверный тип токена", http.StatusUnauthorized)
		return
	}

	userID := claims["user_id"].(string)
	login := claims["login"].(string)

	// Проверяем, что токен есть в базе
	collection := am.mongoClient.Database("App").Collection("Users")
	filter := bson.M{
		"ID":             userID,
		"refresh_tokens": req.RefreshToken,
	}

	var user bson.M
	if collection.FindOne(context.TODO(), filter).Decode(&user) != nil {
		http.Error(w, "Refresh token не найден", http.StatusUnauthorized)
		return
	}

	// Генерируем новый access token
	newAccessToken := createAccessToken(userID, login)

	response := map[string]string{
		"access_token": newAccessToken,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// POST /api/auth/logout
func (am *AuthModule) handleLogout(w http.ResponseWriter, r *http.Request) {
	allDevices := r.URL.Query().Get("all") == "true"

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Неверный запрос", http.StatusBadRequest)
		return
	}

	// Проверяем токен
	token, err := jwt.Parse(req.RefreshToken, func(t *jwt.Token) (interface{}, error) {
		return []byte(JWT_SECRET), nil
	})

	if err != nil || !token.Valid {
		http.Error(w, "Невалидный токен", http.StatusUnauthorized)
		return
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || claims["type"] != "refresh" {
		http.Error(w, "Неверный тип токена", http.StatusUnauthorized)
		return
	}

	userID := claims["user_id"].(string)
	collection := am.mongoClient.Database("App").Collection("Users")

	if allDevices {
		// Удаляем все refresh tokens пользователя
		update := bson.M{"$set": bson.M{"refresh_tokens": []string{}}}
		collection.UpdateOne(context.TODO(), bson.M{"ID": userID}, update)
	} else {
		// Удаляем только указанный токен
		update := bson.M{"$pull": bson.M{"refresh_tokens": req.RefreshToken}}
		collection.UpdateOne(context.TODO(), bson.M{"ID": userID}, update)
	}

	response := map[string]string{
		"status": "logged_out",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// ==================== ОБНОВЛЕННЫЕ OAuth ОБРАБОТЧИКИ ====================

func (am *AuthModule) handleGitHubOauth(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	errorMsg := r.URL.Query().Get("error")

	// Проверяем токен входа
	am.authState.tokensMutex.RLock()
	loginState, exists := am.authState.loginTokens[state]
	am.authState.tokensMutex.RUnlock()

	if !exists || time.Since(loginState.CreatedAt) > 5*time.Minute {
		http.Error(w, "Сессия устарела", http.StatusBadRequest)
		return
	}

	if errorMsg != "" {
		// Пользователь отказался
		am.authState.tokensMutex.Lock()
		am.authState.loginTokens[state] = LoginToken{
			CreatedAt: loginState.CreatedAt,
			Status:    "denied",
		}
		am.authState.tokensMutex.Unlock()

		http.Redirect(w, r, "http://localhost:5173?auth=denied", http.StatusSeeOther)
		return
	}

	if code != "" {
		am.authState.mu.Lock()
		am.authState.IsDone = true
		am.authState.Code = code
		am.authState.Type = "github"
		am.authState.mu.Unlock()

		// Получаем токен и данные пользователя
		accessToken := am.getGitHubAccessToken(code)
		if accessToken == "" {
			http.Error(w, "Не удалось получить токен доступа", http.StatusInternalServerError)
			return
		}

		userData, err := am.getGitHubUserData(accessToken)
		if err != nil {
			http.Error(w, "Не удалось получить данные пользователя", http.StatusInternalServerError)
			return
		}

		// Сохраняем пользователя
		userID := fmt.Sprintf("github_%d", userData.ID)
		if err := am.saveUserWithTokens(userData.Login, userID, "github"); err != nil {
			log.Printf("Ошибка сохранения пользователя: %v", err)
		}

		// Генерируем JWT токены
		accessTokenJWT := createAccessToken(userID, userData.Login)
		refreshTokenJWT := createRefreshToken(userID, userData.Login)

		// Сохраняем refresh token в MongoDB
		collection := am.mongoClient.Database("App").Collection("Users")
		update := bson.M{"$addToSet": bson.M{"refresh_tokens": refreshTokenJWT}}
		collection.UpdateOne(context.TODO(), bson.M{"ID": userID}, update)

		// Обновляем статус токена входа
		am.authState.tokensMutex.Lock()
		am.authState.loginTokens[state] = LoginToken{
			CreatedAt:    loginState.CreatedAt,
			Status:       "granted",
			UserID:       userID,
			AccessToken:  accessTokenJWT,
			RefreshToken: refreshTokenJWT,
		}
		am.authState.tokensMutex.Unlock()

		go notifyNodeAuth(state, userData.Login)

		// Перенаправляем на страницу успеха
		redirectURL := fmt.Sprintf(
			"http://localhost/api/auth/confirm?state=%s&user=%s",
			state,
			url.QueryEscape(userData.Login),
		)
		http.Redirect(w, r, redirectURL, http.StatusSeeOther)

	} else {
		http.Error(w, "Код авторизации не получен", http.StatusBadRequest)
	}
}

func (am *AuthModule) handleYandexOauth(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	errorMsg := r.URL.Query().Get("error")

	// Проверяем токен входа
	am.authState.tokensMutex.RLock()
	loginState, exists := am.authState.loginTokens[state]
	am.authState.tokensMutex.RUnlock()

	if !exists || time.Since(loginState.CreatedAt) > 5*time.Minute {
		http.Error(w, "Сессия устарела", http.StatusBadRequest)
		return
	}

	if errorMsg != "" {
		// Пользователь отказался
		am.authState.tokensMutex.Lock()
		am.authState.loginTokens[state] = LoginToken{
			CreatedAt: loginState.CreatedAt,
			Status:    "denied",
		}
		am.authState.tokensMutex.Unlock()

		http.Redirect(w, r, "http://localhost:5173?auth=denied", http.StatusSeeOther)
		return
	}

	if code != "" {
		am.authState.mu.Lock()
		am.authState.IsDone = true
		am.authState.Code = code
		am.authState.Type = "yandex"
		am.authState.mu.Unlock()

		// Получаем токен доступа
		accessToken, err := am.getYandexAccessToken(code)
		if err != nil {
			http.Error(w, "Не удалось получить токен доступа Яндекс", http.StatusInternalServerError)
			return
		}

		// Получаем данные пользователя
		userData, err := am.getYandexUserInfo(accessToken)
		if err != nil {
			http.Error(w, "Не удалось получить данные пользователя Яндекс", http.StatusInternalServerError)
			return
		}

		// Сохраняем пользователя
		userID := fmt.Sprintf("yandex_%s", userData.ID)
		if err := am.saveUserWithTokens(userData.Login, userID, "yandex"); err != nil {
			log.Printf("Ошибка сохранения пользователя: %v", err)
		}

		// Генерируем JWT токены
		accessTokenJWT := createAccessToken(userID, userData.Login)
		refreshTokenJWT := createRefreshToken(userID, userData.Login)

		// Сохраняем refresh token в MongoDB
		collection := am.mongoClient.Database("App").Collection("Users")
		update := bson.M{"$addToSet": bson.M{"refresh_tokens": refreshTokenJWT}}
		collection.UpdateOne(context.TODO(), bson.M{"ID": userID}, update)

		// Обновляем статус токена входа
		am.authState.tokensMutex.Lock()
		am.authState.loginTokens[state] = LoginToken{
			CreatedAt:    loginState.CreatedAt,
			Status:       "granted",
			UserID:       userID,
			AccessToken:  accessTokenJWT,
			RefreshToken: refreshTokenJWT,
		}
		am.authState.tokensMutex.Unlock()

		go notifyNodeAuth(state, userData.Login)

		// Перенаправляем на страницу успеха
		redirectURL := fmt.Sprintf(
			"http://localhost/api/auth/confirm?state=%s&user=%s",
			state,
			url.QueryEscape(userData.Login),
		)
		http.Redirect(w, r, redirectURL, http.StatusSeeOther)
	} else {
		http.Error(w, "Код авторизации не получен", http.StatusBadRequest)
	}
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

func (am *AuthModule) saveUserWithTokens(login, userID, provider string) error {
	if am.mongoClient == nil {
		return fmt.Errorf("MongoDB клиент не инициализирован")
	}

	collection := am.mongoClient.Database("App").Collection("Users")

	// Создаём пользователя с полем для refresh токенов
	userDoc := bson.M{
		"ID":             userID,
		"Login":          login,
		"Access":         "Student",
		"Type":           provider,
		"refresh_tokens": []string{}, // Добавляем поле для хранения refresh токенов
	}

	// Используем upsert (создаём если нет, обновляем если есть)
	opts := options.Update().SetUpsert(true)
	_, err := collection.UpdateOne(
		context.TODO(),
		bson.M{"ID": userID},
		bson.M{"$setOnInsert": userDoc},
		opts,
	)

	if err != nil {
		return fmt.Errorf("ошибка сохранения пользователя: %v", err)
	}

	log.Printf("Пользователь %s (%s) обновлён в MongoDB", login, provider)
	return nil
}

// ==================== ВАШ СУЩЕСТВУЮЩИЙ КОД (остаётся без изменений) ====================

func (am *AuthModule) ConnectMongoDB() error {
	client, err := mongo.Connect(context.TODO(), options.Client().ApplyURI(MONGODB_URI))
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err = client.Ping(ctx, nil)
	if err != nil {
		return err
	}

	am.mongoClient = client
	log.Println("Подключено к MongoDB")
	return nil
}

func (am *AuthModule) DisconnectMongoDB() {
	if am.mongoClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := am.mongoClient.Disconnect(ctx); err != nil {
			log.Printf("Ошибка отключения от MongoDB: %v", err)
		} else {
			log.Println("Отключено от MongoDB")
		}
	}
}

func (am *AuthModule) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	am.authState.mu.RLock()
	isDone := am.authState.IsDone
	Type := am.authState.Type
	am.authState.mu.RUnlock()

	response := map[string]interface{}{
		"is_done": isDone,
		"type":    Type,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (am *AuthModule) handleAuthURL(w http.ResponseWriter, r *http.Request) {
	Type := r.URL.Query().Get("type")

	var authURL string
	var TypeName string

	switch Type {
	case "yandex":
		authURL = fmt.Sprintf(
			"https://oauth.yandex.ru/authorize?response_type=code&client_id=%s&redirect_uri=%s",
			YANDEX_CLIENT_ID,
			url.QueryEscape(YANDEX_CALLBACK_URL),
		)
		TypeName = "Яндекс"
	default: // github по умолчанию
		authURL = fmt.Sprintf(
			"https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&scope=user",
			GITHUB_CLIENT_ID,
			url.QueryEscape(GITHUB_CALLBACK_URL),
		)
		TypeName = "GitHub"
	}

	response := map[string]string{
		"auth_url": authURL,
		"type":     TypeName,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (am *AuthModule) getGitHubAccessToken(code string) string {
	apiURL := "https://github.com/login/oauth/access_token"

	data := url.Values{
		"client_id":     []string{GITHUB_CLIENT_ID},
		"client_secret": []string{GITHUB_CLIENT_SECRET},
		"code":          []string{code},
		"redirect_uri":  []string{GITHUB_CALLBACK_URL},
	}

	resp, err := http.PostForm(apiURL, data)
	if err != nil {
		log.Printf("Ошибка запроса GitHub токена: %v", err)
		return ""
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	body := string(bodyBytes)

	if strings.Contains(body, "access_token=") {
		parts := strings.Split(body, "&")
		for _, part := range parts {
			if strings.HasPrefix(part, "access_token=") {
				token := strings.TrimPrefix(part, "access_token=")
				return strings.Split(token, "&")[0]
			}
		}
	}

	log.Printf("Неизвестный формат ответа GitHub: %s", body)
	return ""
}

func (am *AuthModule) getGitHubUserData(accessToken string) (GitHubUserData, error) {
	req, err := http.NewRequest("GET", "https://api.github.com/user", nil)
	if err != nil {
		return GitHubUserData{}, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return GitHubUserData{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return GitHubUserData{}, fmt.Errorf("GitHub вернул статус %d", resp.StatusCode)
	}

	var data GitHubUserData
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return GitHubUserData{}, err
	}

	// Получаем email отдельным запросом
	reqEmail, _ := http.NewRequest("GET", "https://api.github.com/user/emails", nil)
	reqEmail.Header.Set("Authorization", "Bearer "+accessToken)
	respEmail, err := http.DefaultClient.Do(reqEmail)
	if err == nil && respEmail.StatusCode == http.StatusOK {
		defer respEmail.Body.Close()
		var emails []struct {
			Email    string `json:"email"`
			Primary  bool   `json:"primary"`
			Verified bool   `json:"verified"`
		}
		if json.NewDecoder(respEmail.Body).Decode(&emails) == nil {
			for _, email := range emails {
				if email.Primary && email.Verified {
					data.Email = email.Email
					break
				}
			}
		}
	}

	return data, nil
}

func (am *AuthModule) getYandexAccessToken(code string) (string, error) {
	apiURL := "https://oauth.yandex.ru/token"

	data := url.Values{
		"grant_type":    []string{"authorization_code"},
		"code":          []string{code},
		"client_id":     []string{YANDEX_CLIENT_ID},
		"client_secret": []string{YANDEX_CLIENT_SECRET},
	}

	resp, err := http.PostForm(apiURL, data)
	if err != nil {
		return "", fmt.Errorf("ошибка запроса Яндекс токена: %v", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	bodyStr := string(bodyBytes)

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("яндекс вернул ошибку")
	}

	var result struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int    `json:"expires_in"`
		RefreshToken string `json:"refresh_token"`
		Scope        string `json:"scope"`
	}

	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		return "", fmt.Errorf("ошибка парсинга ответа Яндекс: %v", err)
	}

	if result.AccessToken == "" {
		return "", fmt.Errorf("яндекс не вернул access token: %s", bodyStr)
	}
	return result.AccessToken, nil
}

func (am *AuthModule) getYandexUserInfo(accessToken string) (YandexUserData, error) {
	apiURL := "https://login.yandex.ru/info"

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return YandexUserData{}, err
	}

	req.Header.Set("Authorization", "OAuth "+accessToken)
	q := req.URL.Query()
	q.Add("format", "json")
	req.URL.RawQuery = q.Encode()

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return YandexUserData{}, err
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return YandexUserData{}, fmt.Errorf("ошибка получения данных: статус %d, тело: %s",
			resp.StatusCode, string(bodyBytes))
	}

	var userInfo YandexUserData
	if err := json.Unmarshal(bodyBytes, &userInfo); err != nil {
		return YandexUserData{}, fmt.Errorf("ошибка парсинга данных пользователя: %v", err)
	}

	return userInfo, nil
}

func (am *AuthModule) WaitForAuthCLI() {
	scanner := bufio.NewScanner(os.Stdin)

	fmt.Println("Модуль авторизации запущен")
	fmt.Println("Доступные провайдеры: github, yandex")
	fmt.Println("Ожидание авторизации...")

	for {
		am.authState.mu.RLock()
		isDone := am.authState.IsDone
		Type := am.authState.Type
		am.authState.mu.RUnlock()

		if isDone {
			fmt.Printf("%s аутентификация успешно завершена!\n", Type)
			break
		}

		fmt.Print("Нажмите Enter для проверки статуса или 'q' для выхода: ")
		scanner.Scan()
		input := scanner.Text()

		if strings.ToLower(input) == "q" {
			fmt.Println("Выход...")
			return
		}
	}
}

func notifyNodeAuth(state, username string) {
	url := fmt.Sprintf(
		"http://localhost:3001/api/auth/confirm?state=%s&user=%s",
		state,
		url.QueryEscape(username),
	)

	resp, err := http.Get(url)
	if err != nil {
		log.Println("Node не отвечает:", err)
		return
	}
	defer resp.Body.Close()

	log.Println("Node уведомлён. Пользователь:", username)
}

func main() {
	authModule := NewAuthModule()

	// Подключаемся к MongoDB
	if err := authModule.ConnectMongoDB(); err != nil {
		log.Fatalf("Ошибка подключения к MongoDB: %v", err)
	}
	defer authModule.DisconnectMongoDB()

	// Запускаем сервер авторизации
	go authModule.StartAuthServer()

	// Ожидаем авторизации (CLI режим)
	authModule.WaitForAuthCLI()
}
