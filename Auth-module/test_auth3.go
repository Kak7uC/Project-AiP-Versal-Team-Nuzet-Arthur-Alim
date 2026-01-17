package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
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
	JWT_SECRET  = "sigma"
)

type User struct {
	ID            string    `bson:"id"`
	Login         string    `bson:"login"`
	Email         string    `bson:"email"`
	FirstName     string    `bson:"first_name,omitempty"`
	LastName      string    `bson:"last_name,omitempty"`
	Type          string    `bson:"type"`
	Role          string    `bson:"role"`
	Permissions   []string  `bson:"permissions"`
	RefreshTokens []string  `bson:"refresh_tokens"`
	IsBlocked     bool      `bson:"is_blocked"`
	CreatedAt     time.Time `bson:"created_at"`
}
type LoginToken struct {
	CreatedAt    time.Time
	Status       string
	UserID       string
	AccessToken  string
	RefreshToken string
}

type AuthState struct {
	loginTokens map[string]LoginToken
	tokensMutex sync.RWMutex
	IsDone      bool
	Code        string
	Type        string
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
type AuthCode struct {
	Code       string    `bson:"code"`
	UserID     string    `bson:"user_id"`
	LoginToken string    `bson:"Login_token"`
	CreatedAt  time.Time `bson:"created_at"`
	ExpiresAt  time.Time `bson:"expires_at"`
	Used       bool      `bson:"used"`
}

var rolesPermissions = map[string][]string{
	"Student": {
		"user:fullName:write:self",
		"user:data:read:self",
		"course:list:read",
		"course:info:read",
		"course:testList:self",
		"course:test:read:self",
		"course:user:add:self",
		"course:user:del:self",
		"quest:read:self",
		"quest:read:attempt",
		"test:answer:read:self",
		"attempt:create:self",
		"attempt:update:self",
		"attempt:complete:self",
		"attempt:read:self",
		"answer:read:self",
		"answer:update:self",
		"answer:del:self",
	},

	"Teacher": {
		"user:fullName:write:self",
		"user:data:read:self",
		"course:list:read",
		"course:info:read",
		"course:testList:self",
		"course:test:read:self",
		"course:user:add:self",
		"course:user:del:self",
		"quest:read:self",
		"quest:read:attempt",
		"test:answer:read:self",
		"attempt:create:self",
		"attempt:update:self",
		"attempt:complete:self",
		"attempt:read:self",
		"answer:read:self",
		"answer:update:self",
		"answer:del:self",
		"user:list:read",
		"user:data:read:others",
		"user:roles:read:others",
		"user:block:read:others",
		"course:info:write:own",
		"course:testList:others",
		"course:test:write:own",
		"course:test:add:own",
		"course:test:del:own",
		"course:userList:own",
		"course:user:add:others",
		"course:user:del:others",
		"course:add",
		"course:del:own",
		"quest:list:read:self",
		"quest:update:self",
		"quest:create",
		"quest:del:self",
		"test:quest:del:own",
		"test:quest:add:own",
		"test:quest:update:own",
		"test:answer:read:others",
	},

	"Admin": {
		"user:*",
		"course:*",
		"quest:*",
		"test:*",
		"attempt:*",
		"answer:*",
	},
}

func NewAuthModule() *AuthModule {
	return &AuthModule{
		authState: AuthState{
			loginTokens: make(map[string]LoginToken),
		},
	}
}

func createAccessToken(user User) string {
	claims := jwt.MapClaims{
		"user_id":     user.ID,
		"login":       user.Login,
		"email":       user.Email,
		"role":        user.Role,
		"permissions": user.Permissions,
		"exp":         time.Now().Add(1 * time.Minute).Unix(),
		"type":        "access",
	}

	if user.FirstName != "" {
		claims["first_name"] = user.FirstName
	}
	if user.LastName != "" {
		claims["last_name"] = user.LastName
	}

	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(JWT_SECRET))
	return token
}

func createRefreshToken(user User) string {
	claims := jwt.MapClaims{
		"user_id": user.ID,
		"login":   user.Login,
		"exp":     time.Now().Add(7 * 24 * time.Hour).Unix(),
		"type":    "refresh",
	}
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(JWT_SECRET))
	return token
}

func (am *AuthModule) StartAuthServer() {
	http.HandleFunc("/api/auth/init", am.handleInitAuth)
	http.HandleFunc("/api/auth/check/", am.handleCheckAuth)
	http.HandleFunc("/api/auth/refresh", am.handleRefreshToken)
	http.HandleFunc("/api/auth/logout", am.handleLogout)

	http.HandleFunc("/oauth/github", am.handleGitHubOauth)
	http.HandleFunc("/oauth/yandex", am.handleYandexOauth)
	http.HandleFunc("/oauth/code", am.handleGenerateCode)
	http.HandleFunc("/oauth/code/verify", am.handleVerifyCode)

	http.HandleFunc("/api/auth/status", am.handleAuthStatus)
	http.HandleFunc("/api/auth/url", am.handleAuthURL)

	http.HandleFunc("/api/user/update", am.changeusername)
	http.HandleFunc("/api/user/update/other", am.changeotherusername)
	http.HandleFunc("/api/user/name", am.viewothername)

	http.HandleFunc("/api/user/viewallusers", am.viewallusers)

	http.HandleFunc("/api/user/role", am.viewotherrole)
	http.HandleFunc("/api/user/roleedit", am.editotherrole)

	http.HandleFunc("/api/user/blocked", am.checkUserBlock)
	http.HandleFunc("/api/user/blockededit", am.toggleUserBlock)

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

func (am *AuthModule) getUserIDFromLoginToken(RefreshToken string) string {
	if RefreshToken == "" {
		return ""
	}

	token, err := jwt.Parse(RefreshToken, func(token *jwt.Token) (interface{}, error) {
		return []byte(JWT_SECRET), nil
	})

	if err != nil || !token.Valid {
		return ""
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return ""
	}

	tokenType, ok := claims["type"].(string)
	if !ok || tokenType != "refresh" {
		return ""
	}

	userID, ok := claims["user_id"].(string)
	if !ok || userID == "" {
		return ""
	}

	if exp, ok := claims["exp"].(float64); ok {
		expTime := time.Unix(int64(exp), 0)
		if time.Now().After(expTime) {
			return ""
		}
	} else {
		return ""
	}

	return userID
}

func (am *AuthModule) handleGenerateCode(w http.ResponseWriter, r *http.Request) {
	refreshToken := r.URL.Query().Get("refresh_token")
	if refreshToken == "" {
		http.Error(w, "login_token is required", http.StatusBadRequest)
		return
	}
	userID := am.getUserIDFromLoginToken(refreshToken)

	code := fmt.Sprintf("%06d", rand.Intn(1000000))

	authCode := AuthCode{
		Code:      code,
		UserID:    userID,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(5 * time.Minute),
		Used:      false,
	}

	am.ConnectMongoDB()
	collection := am.mongoClient.Database("App").Collection("AuthCodes")

	filter := bson.M{"user_id": userID}
	collection.DeleteMany(context.TODO(), filter)

	collection.InsertOne(context.TODO(), authCode)
	response := map[string]interface{}{
		"success":    true,
		"code":       code,
		"expires_in": 300,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (am *AuthModule) handleVerifyCode(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "code is required", http.StatusBadRequest)
		return
	}

	am.ConnectMongoDB()
	collection := am.mongoClient.Database("App").Collection("AuthCodes")

	filter := bson.M{"code": code}
	var authCode AuthCode
	err := collection.FindOne(context.TODO(), filter).Decode(&authCode)

	if err != nil {
		http.Error(w, "Invalid code", http.StatusUnauthorized)
		return
	}

	if time.Now().After(authCode.ExpiresAt) {
		collection.DeleteOne(context.TODO(), filter)
		http.Error(w, "Code expired", http.StatusUnauthorized)
		return
	}

	if authCode.Used {
		http.Error(w, "Code already used", http.StatusUnauthorized)
		return
	}

	update := bson.M{"$set": bson.M{"used": true}}
	collection.UpdateOne(context.TODO(), filter, update)

	userCollection := am.mongoClient.Database("App").Collection("Users")
	userFilter := bson.M{"id": authCode.UserID}
	var user User
	err = userCollection.FindOne(context.TODO(), userFilter).Decode(&user)

	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	a_token := createAccessToken(user)
	r_token := createRefreshToken(user)

	response := map[string]interface{}{
		"success":       true,
		"access_token":  a_token,
		"refresh_token": r_token,
		"user_id":       user.ID,
		"first_name":    user.FirstName,
		"last_name":     user.LastName,
		"role":          user.Role,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
func (am *AuthModule) checkUserBlock(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("ID")

	if targetID == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	am.ConnectMongoDB()

	collection := am.mongoClient.Database("App").Collection("Users")

	filter := bson.M{"id": targetID}

	var user User
	err := collection.FindOne(context.TODO(), filter).Decode(&user)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			http.Error(w, "User not found", http.StatusNotFound)
		} else {
			http.Error(w, "Database error", http.StatusInternalServerError)
		}
		return
	}

	response := map[string]interface{}{
		"success":    true,
		"user_id":    user.ID,
		"is_blocked": user.IsBlocked,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
func (am *AuthModule) toggleUserBlock(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("ID")
	action := r.URL.Query().Get("ACTION")

	if targetID == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	if action != "block" && action != "unblock" {
		http.Error(w, "Action must be 'block' or 'unblock'", http.StatusBadRequest)
		return
	}

	am.ConnectMongoDB()

	collection := am.mongoClient.Database("App").Collection("Users")

	filter := bson.M{"id": targetID}

	isBlocked := action == "block"

	update := bson.M{
		"$set": bson.M{"is_blocked": isBlocked},
	}

	result, err := collection.UpdateOne(context.TODO(), filter, update)
	if err != nil {
		log.Printf("Error updating user block status: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if result.MatchedCount == 0 {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	response := map[string]interface{}{
		"success":    true,
		"user_id":    targetID,
		"is_blocked": isBlocked,
		"action":     action,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
func (am *AuthModule) editotherrole(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("ID")
	targetRole := r.URL.Query().Get("TARGET_ROLE")

	if targetID == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	if targetRole == "" {
		http.Error(w, "TARGET_ROLE is required", http.StatusBadRequest)
		return
	}
	if _, exists := rolesPermissions[targetRole]; !exists {
		validRoles := make([]string, 0, len(rolesPermissions))
		for role := range rolesPermissions {
			validRoles = append(validRoles, role)
		}
		errorMsg := fmt.Sprintf("Invalid role: %s. Valid roles are: %v", targetRole, validRoles)
		http.Error(w, errorMsg, http.StatusBadRequest)
		return
	}

	am.ConnectMongoDB()
	defer am.mongoClient.Disconnect(context.TODO())

	collection := am.mongoClient.Database("App").Collection("Users")

	filter := bson.M{"id": targetID}

	updateData := bson.M{
		"role":        targetRole,
		"permissions": rolesPermissions[targetRole],
	}

	update := bson.M{
		"$set": updateData,
	}

	result, err := collection.UpdateOne(context.TODO(), filter, update)
	if err != nil {
		log.Printf("Error updating user role: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if result.MatchedCount == 0 {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	var updatedUser User
	err = collection.FindOne(context.TODO(), filter).Decode(&updatedUser)
	if err != nil {
		log.Printf("Error finding updated user: %v", err)
		http.Error(w, "Error retrieving updated user", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"success":           true,
		"message":           "Role updated successfully",
		"user_id":           updatedUser.ID,
		"old_role":          updatedUser.Role,
		"new_role":          targetRole,
		"permissions":       rolesPermissions[targetRole],
		"permissions_count": len(rolesPermissions[targetRole]),
	}

	newToken := createAccessToken(updatedUser)
	response["new_access_token"] = newToken

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)

	log.Printf("Role updated for user %s: %s -> %s", targetID, updatedUser.Role, targetRole)
}

func (am *AuthModule) viewothername(w http.ResponseWriter, r *http.Request) {
	targetID := r.URL.Query().Get("ID")
	if targetID == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	am.ConnectMongoDB()
	collection := am.mongoClient.Database("App").Collection("Users")

	filter := bson.M{"id": targetID}
	var user User
	err := collection.FindOne(context.TODO(), filter).Decode(&user)

	if err != nil {
		if err == mongo.ErrNoDocuments {
			http.Error(w, "User not found", http.StatusNotFound)
		} else {
			http.Error(w, "Database error", http.StatusInternalServerError)
		}
		return
	}

	fullName := fmt.Sprintf("%s %s", user.FirstName, user.LastName)
	if strings.TrimSpace(fullName) == "" {
		fullName = user.Login
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(fullName))
}

func (am *AuthModule) checkRoleInDB(requiredRoles []string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			tokenString := strings.TrimPrefix(authHeader, "Bearer ")
			token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
				return []byte(JWT_SECRET), nil
			})

			if err != nil || !token.Valid {
				http.Error(w, "Invalid token", http.StatusUnauthorized)
				return
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				http.Error(w, "Invalid token claims", http.StatusUnauthorized)
				return
			}

			userID, ok := claims["user_id"].(string)
			if !ok || userID == "" {
				http.Error(w, "Invalid user ID in token", http.StatusUnauthorized)
				return
			}

			// Проверяем в БД: актуальная роль и блокировка
			am.ConnectMongoDB()
			collection := am.mongoClient.Database("App").Collection("Users")

			filter := bson.M{"id": userID}
			var user User

			dbErr := collection.FindOne(context.TODO(), filter).Decode(&user)

			if dbErr != nil {
				if dbErr == mongo.ErrNoDocuments {
					http.Error(w, "User not found", http.StatusNotFound)
				} else {
					http.Error(w, "Database error", http.StatusInternalServerError)
				}
				return
			}

			// Проверяем блокировку
			if user.IsBlocked {
				http.Error(w, "User is blocked", http.StatusForbidden)
				return
			}

			// Проверяем роль пользователя
			roleAllowed := false
			for _, requiredRole := range requiredRoles {
				if user.Role == requiredRole {
					roleAllowed = true
					break
				}
			}

			if !roleAllowed {
				if len(requiredRoles) == 1 {
					http.Error(w, fmt.Sprintf("%s access required", requiredRoles[0]), http.StatusForbidden)
				} else {
					http.Error(w, fmt.Sprintf("Access denied. Required roles: %v", requiredRoles), http.StatusForbidden)
				}
				return
			}

			// Добавляем информацию о пользователе в контекст запроса
			ctx := context.WithValue(r.Context(), "user", user)
			r = r.WithContext(ctx)

			next(w, r)
		}
	}
}

func (am *AuthModule) viewotherrole(w http.ResponseWriter, r *http.Request) {
	ID := r.URL.Query().Get("ID")
	if ID == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		http.Error(w, "Authorization required", http.StatusUnauthorized)
		return
	}

	am.ConnectMongoDB()

	collection := am.mongoClient.Database("App").Collection("Users")

	filter := bson.M{"id": ID}

	var user User
	err := collection.FindOne(context.TODO(), filter).Decode(&user)

	if err != nil {
		if err == mongo.ErrNoDocuments {
			http.Error(w, "User not found", http.StatusNotFound)
		} else {
			log.Printf("Error finding user: %v", err)
			http.Error(w, "Database error", http.StatusInternalServerError)
		}
		return
	}

	// 6. Формируем ответ
	response := map[string]interface{}{
		"success": true,
		"user_id": user.ID,
		"login":   user.Login,
		"role":    user.Role,
	}

	// 7. Отправляем JSON ответ
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)

	log.Printf("Returned role for user %s: %s", user.ID, user.Role)
}
func (am *AuthModule) changeusername(w http.ResponseWriter, r *http.Request) {
	new_name := r.URL.Query().Get("first_name")
	new_lastname := r.URL.Query().Get("last_name")
	ID := r.URL.Query().Get("ID")

	if ID == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	if new_name == "" && new_lastname == "" {
		http.Error(w, "At least first_name or last_name is required", http.StatusBadRequest)
		return
	}

	am.ConnectMongoDB()

	collection := am.mongoClient.Database("App").Collection("Users")

	filter := bson.M{"id": ID}

	updateData := bson.M{}
	if new_name != "" {
		updateData["first_name"] = new_name
	}
	if new_lastname != "" {
		updateData["last_name"] = new_lastname
	}

	update := bson.M{
		"$set": updateData,
	}

	_, err := collection.UpdateOne(context.TODO(), filter, update)
	if err != nil {
		log.Printf("Error updating user: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	var updatedUser User
	collection.FindOne(context.TODO(), filter).Decode(&updatedUser)

	response := map[string]interface{}{
		"success": true,
		"message": "Name updated successfully",
		"user_id": ID,
	}

	if new_name != "" {
		response["first_name"] = new_name
	}
	if new_lastname != "" {
		response["last_name"] = new_lastname
	}

	if updatedUser.ID != "" {
		newToken := createAccessToken(updatedUser)
		response["new_access_token"] = newToken
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (am *AuthModule) changeotherusername(w http.ResponseWriter, r *http.Request) {
	new_name := r.URL.Query().Get("first_name")
	new_lastname := r.URL.Query().Get("last_name")
	ID := r.URL.Query().Get("ID")

	if ID == "" {
		http.Error(w, "ID is required", http.StatusBadRequest)
		return
	}

	if new_name == "" && new_lastname == "" {
		http.Error(w, "At least first_name or last_name is required", http.StatusBadRequest)
		return
	}

	am.ConnectMongoDB()

	collection := am.mongoClient.Database("App").Collection("Users")

	filter := bson.M{"id": ID}

	updateData := bson.M{}
	if new_name != "" {
		updateData["first_name"] = new_name
	}
	if new_lastname != "" {
		updateData["last_name"] = new_lastname
	}

	update := bson.M{
		"$set": updateData,
	}

	_, err := collection.UpdateOne(context.TODO(), filter, update)
	if err != nil {
		log.Printf("Error updating user: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
}
func (am *AuthModule) viewallusers(w http.ResponseWriter, r *http.Request) {
	am.ConnectMongoDB()
	collection := am.mongoClient.Database("App").Collection("Users")

	filter := bson.M{}

	cursor, err := collection.Find(context.TODO(), filter)
	if err != nil {
		log.Printf("Error finding users: %v", err)
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer cursor.Close(context.TODO())

	var users []User
	for cursor.Next(context.TODO()) {
		var user User
		if err := cursor.Decode(&user); err != nil {
			log.Printf("Error decoding user: %v", err)
			continue
		}
		users = append(users, user)
	}

	var response []map[string]interface{}
	for _, user := range users {
		response = append(response, map[string]interface{}{
			"id":         user.ID,
			"login":      user.Login,
			"email":      user.Email,
			"first_name": user.FirstName,
			"last_name":  user.LastName,
			"role":       user.Role,
			"type":       user.Type,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"count":   len(users),
		"users":   response,
	})
}
func (am *AuthModule) handleInitAuth(w http.ResponseWriter, r *http.Request) {
	authType := r.URL.Query().Get("type")
	loginToken := r.URL.Query().Get("login_token")

	if loginToken == "" {
		http.Error(w, "Нужен login_token", http.StatusBadRequest)
		return
	}

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

func (am *AuthModule) handleCheckAuth(w http.ResponseWriter, r *http.Request) {
	pathParts := strings.Split(r.URL.Path, "/")
	// fix
	if len(pathParts) < 5 {
		http.Error(w, "Неверный URL", http.StatusBadRequest)
		return
	}
	loginToken := pathParts[len(pathParts)-1]
	// fix

	am.authState.tokensMutex.RLock()
	state, exists := am.authState.loginTokens[loginToken]
	am.authState.tokensMutex.RUnlock()

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

func (am *AuthModule) handleRefreshToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Неверный запрос", http.StatusBadRequest)
		return
	}

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

	collection := am.mongoClient.Database("App").Collection("Users")

	var user User
	err = collection.FindOne(context.TODO(), bson.M{
		"id":             userID,
		"refresh_tokens": req.RefreshToken,
	}).Decode(&user)

	if err != nil {
		http.Error(w, "Refresh token не найден", http.StatusUnauthorized)
		return
	}

	newAccessToken := createAccessToken(user)

	response := map[string]string{
		"access_token": newAccessToken,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (am *AuthModule) handleLogout(w http.ResponseWriter, r *http.Request) {
	allDevices := r.URL.Query().Get("all") == "true"

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Неверный запрос", http.StatusBadRequest)
		return
	}

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
		update := bson.M{"$set": bson.M{"refresh_tokens": []string{}}}
		collection.UpdateOne(context.TODO(), bson.M{"id": userID}, update)
	} else {
		update := bson.M{"$pull": bson.M{"refresh_tokens": req.RefreshToken}}
		collection.UpdateOne(context.TODO(), bson.M{"id": userID}, update)
	}

	response := map[string]string{
		"status": "logged_out",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (am *AuthModule) handleGitHubOauth(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	errorMsg := r.URL.Query().Get("error")

	am.authState.tokensMutex.RLock()
	loginState, exists := am.authState.loginTokens[state]
	am.authState.tokensMutex.RUnlock()

	if !exists || time.Since(loginState.CreatedAt) > 5*time.Minute {
		http.Error(w, "Сессия устарела", http.StatusBadRequest)
		return
	}

	if errorMsg != "" {
		am.authState.tokensMutex.Lock()
		am.authState.loginTokens[state] = LoginToken{
			CreatedAt: loginState.CreatedAt,
			Status:    "denied",
		}
		am.authState.tokensMutex.Unlock()

		http.Redirect(w, r, "http://localhost:3001/api/auth/confirm?state=%s&user=%s", http.StatusSeeOther)
		return
	}

	if code != "" {
		am.authState.mu.Lock()
		am.authState.IsDone = true
		am.authState.Code = code
		am.authState.Type = "github"
		am.authState.mu.Unlock()

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

		userID := fmt.Sprintf("github_%d", userData.ID)

		defaultRole := "Student"
		permissions := rolesPermissions[defaultRole]

		user := User{
			ID:            userID,
			Login:         userData.Login,
			Email:         userData.Email,
			FirstName:     "",
			LastName:      "",
			Type:          "github",
			Role:          defaultRole,
			Permissions:   permissions,
			RefreshTokens: []string{},
			CreatedAt:     time.Now(),
		}
		if err := am.saveUserWithTokens(user); err != nil {
			log.Printf("Ошибка сохранения пользователя: %v", err)
		}

		accessTokenJWT := createAccessToken(user)
		refreshTokenJWT := createRefreshToken(user)

		collection := am.mongoClient.Database("App").Collection("Users")
		update := bson.M{"$addToSet": bson.M{"refresh_tokens": refreshTokenJWT}}
		collection.UpdateOne(context.TODO(), bson.M{"id": userID}, update)

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

		redirectURL := fmt.Sprintf("http://localhost:3001/api/auth/confirm?state=%s&user=%s", state, userData.Login)
		http.Redirect(w, r, redirectURL, http.StatusSeeOther) // fix это нужно для нузета

	} else {
		http.Error(w, "Код авторизации не получен", http.StatusBadRequest)
	}
}

func (am *AuthModule) handleYandexOauth(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	errorMsg := r.URL.Query().Get("error")

	am.authState.tokensMutex.RLock()
	loginState, exists := am.authState.loginTokens[state]
	am.authState.tokensMutex.RUnlock()

	if !exists || time.Since(loginState.CreatedAt) > 5*time.Minute {
		http.Error(w, "Сессия устарела", http.StatusBadRequest)
		return
	}

	if errorMsg != "" {
		am.authState.tokensMutex.Lock()
		am.authState.loginTokens[state] = LoginToken{
			CreatedAt: loginState.CreatedAt,
			Status:    "denied",
		}
		am.authState.tokensMutex.Unlock()

		http.Redirect(w, r, "http://localhost:3001/api/auth/confirm?state=%s&user=%s", http.StatusSeeOther)
		return
	}

	if code != "" {
		am.authState.mu.Lock()
		am.authState.IsDone = true
		am.authState.Code = code
		am.authState.Type = "yandex"
		am.authState.mu.Unlock()

		accessToken, err := am.getYandexAccessToken(code)
		if err != nil {
			http.Error(w, "Не удалось получить токен доступа Яндекс", http.StatusInternalServerError)
			return
		}

		userData, err := am.getYandexUserInfo(accessToken)
		if err != nil {
			http.Error(w, "Не удалось получить данные пользователя Яндекс", http.StatusInternalServerError)
			return
		}

		userID := fmt.Sprintf("yandex_%s", userData.ID)

		defaultRole := "Student"
		permissions := rolesPermissions[defaultRole]

		user := User{
			ID:            userID,
			Login:         userData.Login,
			Email:         userData.DefaultEmail,
			FirstName:     "",
			LastName:      "",
			Type:          "yandex",
			Role:          defaultRole,
			Permissions:   permissions,
			RefreshTokens: []string{},
			CreatedAt:     time.Now(),
		}

		if err := am.saveUserWithTokens(user); err != nil {
			log.Printf("Ошибка сохранения пользователя: %v", err)
		}

		accessTokenJWT := createAccessToken(user)
		refreshTokenJWT := createRefreshToken(user)

		collection := am.mongoClient.Database("App").Collection("Users")
		update := bson.M{"$addToSet": bson.M{"refresh_tokens": refreshTokenJWT}}
		collection.UpdateOne(context.TODO(), bson.M{"id": userID}, update)

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

		redirectURL := fmt.Sprintf("http://localhost:3001/api/auth/confirm?state=%s&user=%s", state, userData.Login)
		http.Redirect(w, r, redirectURL, http.StatusSeeOther) // fix тут ничего не меняй, это нужно для веб
	} else {
		http.Error(w, "Код авторизации не получен", http.StatusBadRequest)
	}
}
func (am *AuthModule) saveUserWithTokens(user User) error {
	if am.mongoClient == nil {
		return fmt.Errorf("MongoDB клиент не инициализирован")
	}

	collection := am.mongoClient.Database("App").Collection("Users")

	opts := options.Update().SetUpsert(true)
	_, err := collection.UpdateOne(
		context.TODO(),
		bson.M{"id": user.ID},
		bson.M{
			"$setOnInsert": bson.M{
				"id":             user.ID,
				"Login":          user.Login,
				"Email":          user.Email,
				"FirstName":      user.FirstName,
				"LastName":       user.LastName,
				"Type":           user.Type,
				"role":           user.Role,
				"permissions":    user.Permissions,
				"refresh_tokens": []string{},
				"CreatedAt":      time.Now(),
			},
		},
		opts,
	)

	if err != nil {
		return fmt.Errorf("ошибка сохранения пользователя: %v", err)
	}

	log.Printf("Пользователь %s (%s) обновлён в MongoDB", user.Login, user.Type)
	return nil
}

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
	default:
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

	if err := authModule.ConnectMongoDB(); err != nil {
		log.Fatalf("Ошибка подключения к MongoDB: %v", err)
	}
	defer authModule.DisconnectMongoDB()

	go authModule.StartAuthServer()

	authModule.WaitForAuthCLI()
}
