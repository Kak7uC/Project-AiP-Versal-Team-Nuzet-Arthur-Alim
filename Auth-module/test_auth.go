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
)

type AuthState struct {
	IsDone bool
	Code   string
	Type   string // "github" или "yandex"
	mu     sync.RWMutex
}

type GitHubUserData struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
}

type YandexUserData struct {
	ID     string `json:"id"`
	Login  string `json:"login"`
	Access string `json:"access"`
}

type AuthModule struct {
	authState   AuthState
	mongoClient *mongo.Client
}

func NewAuthModule() *AuthModule {
	return &AuthModule{
		authState: AuthState{},
	}
}

func (am *AuthModule) ConnectMongoDB() error {
	client, err := mongo.Connect(context.TODO(), options.Client().ApplyURI(MONGODB_URI))
	if err != nil {
		return err
	}

	// Проверяем соединение
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

func (am *AuthModule) StartAuthServer() {
	http.HandleFunc("/oauth/github", am.handleGitHubOauth)
	http.HandleFunc("/oauth/yandex", am.handleYandexOauth)

	log.Println("Сервер авторизации запущен на порту 8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Ошибка запуска сервера: %v", err)
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

func (am *AuthModule) handleGitHubOauth(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")

	code := r.URL.Query().Get("code")
	errorMsg := r.URL.Query().Get("error")

	if errorMsg != "" {
		http.Error(w, "Ошибка авторизации GitHub: "+errorMsg, http.StatusBadRequest)
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
		go notifyNodeAuth(state, userData.Login)

		if err != nil {
			http.Error(w, "Не удалось получить данные пользователя", http.StatusInternalServerError)
			return
		}

		// Сохраняем в MongoDB
		if err := am.saveUserToMongoDB(userData.Login, fmt.Sprintf("%d", userData.ID), "github"); err != nil {
			log.Printf("Ошибка сохранения пользователя: %v", err)
		}

		// Перенаправляем на страницу успеха
		http.Redirect(w, r, "http://localhost:5173", http.StatusSeeOther)

	} else {
		http.Error(w, "Код авторизации не получен", http.StatusBadRequest)
	}
}

func (am *AuthModule) handleYandexOauth(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	errorMsg := r.URL.Query().Get("error")

	if errorMsg != "" {
		http.Error(w, "Ошибка авторизации Яндекс: "+errorMsg, http.StatusBadRequest)
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
		go notifyNodeAuth(state, userData.Login)

		// Сохраняем в MongoDB
		if err := am.saveUserToMongoDB(userData.Login, userData.ID, "yandex"); err != nil {
			log.Printf("Ошибка сохранения пользователя: %v", err)
		}

		// Перенаправляем на страницу успеха
		http.Redirect(w, r, "http://localhost:5173", http.StatusSeeOther)
	} else {
		http.Error(w, "Код авторизации не получен", http.StatusBadRequest)
	}
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

func (am *AuthModule) saveUserToMongoDB(login, userID, Type string) error {
	if am.mongoClient == nil {
		return fmt.Errorf("MongoDB клиент не инициализирован")
	}

	collection := am.mongoClient.Database("App").Collection("Users")

	// Проверяем существование пользователя
	filter := bson.M{"ID": userID}
	var existingUser bson.M
	err := collection.FindOne(context.TODO(), filter).Decode(&existingUser)

	if err == nil {
		log.Printf("Пользователь %s (%s) уже существует в системе", login, Type)
		return nil
	}

	// Вставляем нового пользователя
	_, err = collection.InsertOne(context.TODO(), bson.M{
		"ID":     userID,
		"Login":  login,
		"Access": "Student",
		"Type":   Type,
	})

	if err != nil {
		return fmt.Errorf("ошибка вставки пользователя: %v", err)
	}

	log.Printf("Пользователь %s (%s) добавлен в MongoDB", login, Type)
	return nil
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

	// Запускаем сервер авторизации в отдельной горутине
	go authModule.StartAuthServer()

	// Ожидаем авторизации (CLI режим)
	authModule.WaitForAuthCLI()
}
