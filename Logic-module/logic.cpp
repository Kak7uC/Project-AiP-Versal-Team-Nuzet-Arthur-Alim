#define _WIN32_WINNT 0x0A00
#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <chrono>
#include <libpq-fe.h>
#include <thread>
#include "jwt.h"
#include "httplib.h"
using namespace std;


const string GO_SERVER_URL = "http://localhost:8080";
bool checkPermission(string JWT, string permission) {
    try {
        auto decoded = jwt::decode(JWT);
        
        string role = decoded.get_payload_claim("role").as_string();
        if (role == "Admin") {
            return true;
        }
        
        auto permissions_claim = decoded.get_payload_claim("permissions");
        auto permissions_array = permissions_claim.as_array();
        
        for (size_t i = 0; i < permissions_array.size(); ++i) {
            string user_perm = permissions_array[i].to_str();
            if (user_perm == permission) {
                return true;
            }
        }
        
        return false;
        
    } catch(...) {
        return false;
    }
}

bool TOKEN_APPROVED(string ID, string JWT) {
    const string JWT_SECRET = "sigma";
    
    cout << "=== TOKEN_APPROVED called ===" << endl;
    cout << "ID: " << ID << endl;
    
    if (JWT.empty()) {
        cout << "ERROR: JWT is empty!" << endl;
        return false;
    }
    
    try {
        auto decoded = jwt::decode(JWT);
        
        string user_id = decoded.get_payload_claim("user_id").as_string();
        string type = decoded.get_payload_claim("type").as_string();
        
        // Проверяем совпадение ID
        if (user_id != ID) {
            cout << "User ID mismatch! token:" << user_id << " vs param:" << ID << endl;
            return false;
        }
        
        // Проверяем тип токена
        if (type != "access") {
            cout << "Invalid token type: " << type << endl;
            return false;
        }
        
        try {
            auto exp_claim = decoded.get_payload_claim("exp");
            if (exp_claim.get_type() == jwt::json::type::number) {
                double exp_double = exp_claim.as_number();
                auto now = chrono::system_clock::now();
                auto now_sec = chrono::duration_cast<chrono::seconds>(
                    now.time_since_epoch()).count();
                
                if (exp_double < now_sec) {
                    cout << "Token expired!" << endl;
                    return false;
                }
            }
        } catch(...) {
            cout << "No exp claim in token" << endl;
            return false;
        }
        
        // Проверяем подпись
        auto verifier = jwt::verify()
            .allow_algorithm(jwt::algorithm::hs256{JWT_SECRET});
        verifier.verify(decoded);
        
        cout << "All checks passed, returning TRUE" << endl;
        return true;
        
    } catch (const exception& e) {
        cout << "Exception in TOKEN_APPROVED: " << e.what() << endl;
        return false;
    } catch (...) {
        cout << "Unknown exception in TOKEN_APPROVED" << endl;
        return false;
    }
}
string VIEW_OWN_NAME(string ID, string JWT) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    try {
        httplib::Client client(GO_SERVER_URL.c_str());
        client.set_connection_timeout(5);
        client.set_read_timeout(5);
        
        httplib::Headers headers = {
            {"Authorization", "Bearer " + JWT}
        };
        
        httplib::Params params = {
            {"ID", ID},
        };
        
        auto response = client.Get("/api/user/name", params, headers);
        
        if (response) {
            if (response->status == 200) {
                return response->body;
            } else {
                return "ERROR " + to_string(response->status) + ": " + response->body;
            }
        } else {
            return "ERROR: Cannot connect to Go server";
        }
        
    } catch (const exception& e) {
        return "EXCEPTION: " + string(e.what());
    }
}

string VIEW_OTHER_NAME(string ID, string TARGET_ID, string JWT) {
    cout << "\n=== VIEW_OTHER_NAME called ===" << endl;
    
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "user:data:read:others")) {
        cout << "DEBUG: No permission to view other users' data" << endl;
        return "ERROR 403";
    }
    
    if (TARGET_ID.empty()) {
        return "ERROR 400: Target user ID required";
    }
    
    try {
        httplib::Client client(GO_SERVER_URL.c_str());
        client.set_connection_timeout(5);
        client.set_read_timeout(5);
        
        httplib::Headers headers = {
            {"Authorization", "Bearer " + JWT}
        };
        
        httplib::Params params = {
            {"ID", TARGET_ID},
        };
        
        auto response = client.Get("/api/user/name", params, headers);
        
        if (response) {
            cout << "DEBUG: Go response status: " << response->status << endl;
            
            if (response->status == 200) {
                return response->body;
            } else {
                return "ERROR " + to_string(response->status) + ": " + response->body;
            }
        } else {
            return "ERROR: Cannot connect to Go server";
        }
        
    } catch (const exception& e) {
        return "EXCEPTION: " + string(e.what());
    }
}
string EDIT_OWN_NAME(string ID, string JWT, string new_name, string new_lastname){
    cout << "\n=== EDIT_OWN_NAME called ===" << endl;
    
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "user:fullName:write:self")){
        cout << "DEBUG: No permission to edit own name" << endl;
        return "ERROR 403";
    }
    
    if (new_name.empty() && new_lastname.empty()) {
        return "ERROR 400: At least one name parameter required";
    }
    
    try {
        httplib::Client client(GO_SERVER_URL.c_str());
        client.set_connection_timeout(5);
        client.set_read_timeout(5);
        
        httplib::Headers headers = {
            {"Authorization", "Bearer " + JWT}
        };
        
        httplib::Params params = {
            {"ID", ID},
            {"first_name", new_name},
            {"last_name", new_lastname}
        };

        auto response = client.Get("/api/user/update", params, headers);
        
        if (response) {
            cout << "DEBUG: Go response status: " << response->status << endl;
            
            if (response->status == 200) {
                // Если Go сервер вернул новый токен, используем его для декодирования
                try {
                    auto decoded = jwt::decode(JWT);
                    auto new_decoded = jwt::decode(response->body);
                    
                    // Обновляем first_name и last_name в текущем токене
                    string updated_result = "";
                    try {
                        string fn = new_decoded.get_payload_claim("first_name").as_string();
                        string ln = new_decoded.get_payload_claim("last_name").as_string();
                        updated_result = fn + " " + ln;
                        if (fn.empty()) updated_result = ln;
                        if (ln.empty()) updated_result = fn;
                    } catch(...) {}
                    
                    return "SUCCESS: Name updated to " + updated_result;
                } catch(...) {
                    return "SUCCESS: Name updated successfully";
                }
            } else {
                return "ERROR " + to_string(response->status) + ": " + response->body;
            }
        } else {
            return "ERROR: Cannot connect to Go server";
        }
    } catch(const exception& e) {
        return "EXCEPTION: " + string(e.what());
    } catch(...) {
        return "ERROR: Exception in EDIT_OWN_NAME";
    }
}
string EDIT_OTHER_NAME(string ID, string TARGET_ID, string JWT, string new_name, string new_lastname){
    cout << "\n=== EDIT_OTHER_NAME called ===" << endl;
    
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    // Проверяем, является ли пользователь админом
    try {
        auto decoded = jwt::decode(JWT);
        string role = decoded.get_payload_claim("role").as_string();
        if (role != "Admin"){
            cout << "DEBUG: Only Admin can edit other names. Role: " << role << endl;
            return "ERROR 403";
        }
    } catch (...) {
        return "ERROR 401: Cannot decode token";
    }
    
    if (TARGET_ID.empty()) {
        return "ERROR 400: Target user ID required";
    }
    
    try {
        httplib::Client client(GO_SERVER_URL.c_str());
        client.set_connection_timeout(5);
        client.set_read_timeout(5);
        
        httplib::Headers headers = {
            {"Authorization", "Bearer " + JWT}
        };
        
        httplib::Params params = {
            {"ID", TARGET_ID},
            {"first_name", new_name},
            {"last_name", new_lastname}
        };
        
        auto response = client.Get("/api/user/update/other", params, headers);
        
        if (response) {
            cout << "DEBUG: Go response status: " << response->status << endl;
            
            if (response->status == 200) {
                return "SUCCESS: User " + TARGET_ID + " name updated successfully";
            } else {
                return "ERROR " + to_string(response->status) + ": " + response->body;
            }
        } else {
            return "ERROR: Cannot connect to Go server";
        }
    } catch(const exception& e) {
        return "EXCEPTION: " + string(e.what());
    } catch(...) {
        return "ERROR: Exception in EDIT_OTHER_NAME";
    }
}
string VIEW_ALL_USERS(string ID, string JWT){
    cout << "\n=== VIEW_ALL_USERS called ===" << endl;
    
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "user:list:read")){
        cout << "DEBUG: No permission to view all users" << endl;
        return "ERROR 403";
    }
    
    try {
        httplib::Client client(GO_SERVER_URL.c_str());
        client.set_connection_timeout(5);
        
        httplib::Headers headers = {{"Authorization", "Bearer " + JWT}};
        
        auto response = client.Get("/api/user/viewallusers", headers);
        
        if (response) {
            cout << "DEBUG: Go response status: " << response->status << endl;
            
            if (response->status == 200) {
                return response->body;
            } else {
                return "ERROR " + to_string(response->status) + ": " + response->body;
            }
        } else {
            return "ERROR: Cannot connect to Go server";
        }
        
    } catch (const exception& e) {
        return "EXCEPTION: " + string(e.what());
    } catch (...) {
        return "ERROR: Unknown exception in VIEW_ALL_USERS";
    }
}
string VIEW_OTHER_ROLES(string ID, string TARGET_ID, string JWT) {
    cout << "\n=== VIEW_OTHER_ROLES called ===" << endl;
    
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "user:roles:read:others")) {
        cout << "DEBUG: No permission to view other roles" << endl;
        return "ERROR 403";
    }
    
    if (TARGET_ID.empty()) {
        return "ERROR 400: Target user ID required";
    }
    
    try {
        httplib::Client client(GO_SERVER_URL.c_str());
        client.set_connection_timeout(5);
        
        httplib::Headers headers = {{"Authorization", "Bearer " + JWT}};
        httplib::Params params = {{"ID", TARGET_ID}};
        
        auto response = client.Get("/api/user/role", params, headers);
        
        if (response) {
            cout << "DEBUG: Go response status: " << response->status << endl;
            
            if (response->status == 200) {
                return response->body;
            } else {
                return "ERROR " + to_string(response->status) + ": " + response->body;
            }
        } else {
            return "ERROR: Cannot connect to Go server";
        }
        
    } catch (const exception& e) {
        return "EXCEPTION: " + string(e.what());
    } catch (...) {
        return "ERROR: Exception in VIEW_OTHER_ROLES";
    }
}
string EDIT_OTHER_ROLES(string ID, string TARGET_ID, string TARGET_ROLE, string JWT){
    if (!TOKEN_APPROVED(ID,JWT)){
        return "ERROR 401";
    }
    try {
        httplib::Client client(GO_SERVER_URL.c_str());
        client.set_connection_timeout(5);
        
        httplib::Headers headers = {{"Authorization", "Bearer " + JWT}};
        httplib::Params params = {{
            {"ID", TARGET_ID},
            {"TARGET_ROLE", TARGET_ROLE}
        }};
        
        auto response = client.Get("/api/user/roleedit", params, headers);
        
        if (response) {
            cout << "DEBUG: Go response status: " << response->status << endl;
            
            if (response->status == 200) {
                return response->body;
            } else {
                return "ERROR " + to_string(response->status) + ": " + response->body;
            }
        } else {
            return "ERROR: Cannot connect to Go server";
        }
        
    } catch (const exception& e) {
        return "EXCEPTION: " + string(e.what());
    } catch (...) {
        return "ERROR: Exception in VIEW_OTHER_ROLES";
    }
}
string VIEW_BLOCKED(string ID, string TARGET_ID, string JWT){
    if (!TOKEN_APPROVED(ID,JWT)){
        return "ERROR 401";
    }
    
    if (TARGET_ID.empty()) {
        return "ERROR 400: Target user ID required";
    }
    try {
        httplib::Client client(GO_SERVER_URL.c_str());
        client.set_connection_timeout(5);
        
        httplib::Headers headers = {{"Authorization", "Bearer " + JWT}};
        httplib::Params params = {{
            {"ID", TARGET_ID}
        }};
        
        auto response = client.Get("/api/user/blocked", params, headers);
        
        if (response) {
            // FIX: Раньше мы искали просто "true", и находили его в "success": true
            // Теперь ищем конкретно поле блокировки
            if (response->status == 200) {
                string body = response->body;
                // Ищем "is_blocked":true или "is_blocked": true
                if (body.find("\"is_blocked\":true") != string::npos || 
                    body.find("\"is_blocked\": true") != string::npos) {
                    return "true";
                }
                return "false";
            } else {
                return "ERROR " + to_string(response->status) + ": " + response->body;
            }
        } else {
            return "ERROR: Cannot connect to Go server";
        }
        
    } catch (const exception& e) {
        return "EXCEPTION: " + string(e.what());
    } catch (...) {
        return "ERROR";
    }
}
string EDIT_BLOCKED(string ID, string TARGET_ID, string ACTION, string JWT){
    if (!TOKEN_APPROVED(ID,JWT)){
        return "ERROR 401";
    }
    try {
        auto decoded = jwt::decode(JWT);
        string role = decoded.get_payload_claim("role").as_string();
        if (role != "Admin"){
            cout << "DEBUG: Only Admin can edit other names. Role: " << role << endl;
            return "ERROR 403";
        }
    } catch (...) {
        return "ERROR 401: Cannot decode token";
    }
    
    if (TARGET_ID.empty()) {
        return "ERROR 400: Target user ID required";
    }
    try {
        httplib::Client client(GO_SERVER_URL.c_str());
        client.set_connection_timeout(5);
        
        httplib::Headers headers = {{"Authorization", "Bearer " + JWT}};
        httplib::Params params;
        params.emplace("ID", TARGET_ID);
        params.emplace("ACTION", ACTION);
        
        auto response = client.Get("/api/user/blockededit", params, headers);
        
        if (response) {
            cout << "DEBUG: Go response status: " << response->status << endl;
            
            if (response->status == 200) {
                return response->body;
            } else {
                return "ERROR " + to_string(response->status) + ": " + response->body;
            }
        } else {
            return "ERROR: Cannot connect to Go server";
        }
        
    } catch (const exception& e) {
        return "EXCEPTION: " + string(e.what());
    } catch (...) {
        return "ERROR";
    
    }
}
string VIEW_OWN_DATA(string ID, string JWT) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "user:data:read:self")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech port=5432 dbname=neondb user=neondb_owner password=npg_tTdv0G5elYum sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) { PQfinish(conn); return "{\"error\":\"DB fail\"}"; }
    
    stringstream json;
    json << "{\"user_id\":\"" << ID << "\", \"courses\":[";
    
    // 1. Курсы (где я учитель ИЛИ где я студент)
    const char* p[1] = {ID.c_str()};
    PGresult* c_res = PQexecParams(conn,
        "SELECT id, name FROM courses WHERE teacher_id = $1 AND NOT is_deleted "
        "UNION "
        "SELECT c.id, c.name FROM courses c JOIN student_courses sc ON c.id = sc.course_id WHERE sc.student_id = $1 AND NOT c.is_deleted",
        1, NULL, p, NULL, NULL, 0);
        
    int c_count = PQntuples(c_res);
    for(int i=0; i<c_count; i++) {
        if (i > 0) json << ",";
        string c_id = PQgetvalue(c_res, i, 0);
        string c_name = PQgetvalue(c_res, i, 1);
        
        json << "{\"course_id\":\"" << c_id << "\", \"course_name\":\"" << c_name << "\",";
        
        // 2. Тесты
        const char* t_p[1] = {c_id.c_str()};
        PGresult* t_res = PQexecParams(conn, "SELECT id, title FROM tests WHERE course_id = $1 AND NOT is_deleted", 1, NULL, t_p, NULL, NULL, 0);
        json << "\"tests\":[";
        int t_count = PQntuples(t_res);
        for(int j=0; j<t_count; j++) {
            if(j>0) json << ",";
            json << "{\"test_id\":\"" << PQgetvalue(t_res, j, 0) << "\", \"test_title\":\"" << PQgetvalue(t_res, j, 1) << "\"}";
        }
        PQclear(t_res);
        json << "],";
        
        // 3. Оценки (ИСПРАВЛЕНО: COALESCE для защиты от null)
        const char* g_p[2] = {ID.c_str(), c_id.c_str()};
        PGresult* g_res = PQexecParams(conn,
            "SELECT t.title, COALESCE(a.score, 0), COALESCE(a.max_score, 0), COALESCE(a.percentage, 0) "
            "FROM attempts a "
            "JOIN tests t ON a.test_id = t.id "
            "WHERE a.student_id = $1 AND t.course_id = $2 AND a.status = 'completed' "
            "ORDER BY a.completed_at DESC",
            2, NULL, g_p, NULL, NULL, 0);
            
        json << "\"grades\":[";
        int g_count = PQntuples(g_res);
        for(int k=0; k<g_count; k++) {
            if(k>0) json << ",";
            json << "{"
                 << "\"test_title\":\"" << PQgetvalue(g_res, k, 0) << "\","
                 << "\"score\":" << PQgetvalue(g_res, k, 1) << ","
                 << "\"max_score\":" << PQgetvalue(g_res, k, 2) << ","
                 << "\"percentage\":" << PQgetvalue(g_res, k, 3) 
                 << "}";
        }
        PQclear(g_res);
        json << "]";
        
        json << "}";
    }
    PQclear(c_res);
    PQfinish(conn);
    json << "]}";
    return json.str();
}
string VIEW_OTHER_DATA(string ID, string TARGET_ID, string JWT) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    if (!checkPermission(JWT, "user:data:read:others") && !checkPermission(JWT, "user:data:read")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech port=5432 dbname=neondb user=neondb_owner password=npg_tTdv0G5elYum sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) { PQfinish(conn); return "{\"error\":\"DB fail\"}"; }
    
    stringstream json;
    json << "{\"user_id\":\"" << TARGET_ID << "\", \"courses\":[";
    
    // 3. Получаем курсы ЦЕЛЕВОГО пользователя (TARGET_ID)
    const char* p[1] = {TARGET_ID.c_str()};
    PGresult* c_res = PQexecParams(conn,
        "SELECT id, name FROM courses WHERE teacher_id = $1 "
        "UNION "
        "SELECT c.id, c.name FROM courses c JOIN student_courses sc ON c.id = sc.course_id WHERE sc.student_id = $1",
        1, NULL, p, NULL, NULL, 0);
        
    int c_count = PQntuples(c_res);
    
    for(int i=0; i<c_count; i++) {
        if (i > 0) json << ",";
        string c_id = PQgetvalue(c_res, i, 0);
        string c_name = PQgetvalue(c_res, i, 1);
        
        json << "{\"course_id\":\"" << c_id << "\", \"course_name\":\"" << c_name << "\",";
        
        const char* t_p[1] = {c_id.c_str()};
        PGresult* t_res = PQexecParams(conn, "SELECT id, title FROM tests WHERE course_id = $1 AND NOT is_deleted", 1, NULL, t_p, NULL, NULL, 0);
        json << "\"tests\":[";
        int t_count = PQntuples(t_res);
        for(int j=0; j<t_count; j++) {
            if(j>0) json << ",";
            json << "{\"test_id\":\"" << PQgetvalue(t_res, j, 0) << "\", \"test_title\":\"" << PQgetvalue(t_res, j, 1) << "\"}";
        }
        PQclear(t_res);
        json << "],";
        
        // Получаем ОЦЕНКИ ЦЕЛЕВОГО пользователя
        const char* g_p[2] = {TARGET_ID.c_str(), c_id.c_str()};
        PGresult* g_res = PQexecParams(conn,
            "SELECT t.title, a.score, a.max_score, a.percentage, a.completed_at "
            "FROM attempts a "
            "JOIN tests t ON a.test_id = t.id "
            "WHERE a.student_id = $1 AND t.course_id = $2 AND a.status = 'completed' "
            "ORDER BY a.completed_at DESC",
            2, NULL, g_p, NULL, NULL, 0);
            
        json << "\"grades\":[";
        int g_count = PQntuples(g_res);
        for(int k=0; k<g_count; k++) {
            if(k>0) json << ",";
            json << "{"
                 << "\"test_title\":\"" << PQgetvalue(g_res, k, 0) << "\","
                 << "\"score\":" << PQgetvalue(g_res, k, 1) << ","
                 << "\"max_score\":" << PQgetvalue(g_res, k, 2) << ","
                 << "\"percentage\":" << PQgetvalue(g_res, k, 3) 
                 << "}";
        }
        PQclear(g_res);
        json << "]";
        
        json << "}";
    }
    PQclear(c_res);
    PQfinish(conn);
    
    json << "]}";
    return json.str();
}
string CREATE_COURSE(string ID, string JWT, string course_name, string description, string teacher_id) {
    
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "course:add")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb(
        "host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require"
    );
    
    if (PQstatus(conn) != CONNECTION_OK) {
        string error = PQerrorMessage(conn);
        PQfinish(conn);
        return "{\"error\":\"DB error: " + error + "\"}";
    }
    
    // Создаем курс
    string course_id = "course_" + to_string(time(0));
    const char* params[4] = {course_id.c_str(), course_name.c_str(), description.c_str(), teacher_id.c_str()};
    
    PGresult* res = PQexecParams(conn,
        "INSERT INTO courses (id, name, description, teacher_id) VALUES ($1, $2, $3, $4) RETURNING id",
        4, NULL, params, NULL, NULL, 0);
    
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        string error = PQresultErrorMessage(res);
        PQclear(res);
        PQfinish(conn);
        return "{\"error\":\"Insert failed: " + error + "\"}";
    }
    
    string created_id = PQgetvalue(res, 0, 0);
    PQclear(res);
    PQfinish(conn);
    
    return "{"
           "\"status\":\"success\","
           "\"course_id\":\"" + created_id + "\","
           "\"course_name\":\"" + course_name + "\""
           "}";
}
string VIEW_ALL_COURSES(string ID, string JWT) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    stringstream json;
    json << "{\"courses\":[";
    PGresult* res = PQexec(conn,
        "SELECT id, name, description FROM courses WHERE NOT is_deleted ORDER BY name");
    
    if (PQresultStatus(res) == PGRES_TUPLES_OK) {
        int num = PQntuples(res);
        for (int i = 0; i < num; i++) {
            if (i > 0) json << ",";
            json << "{\"id\":\"" << PQgetvalue(res, i, 0) << "\",";
            json << "\"name\":\"" << PQgetvalue(res, i, 1) << "\",";
            json << "\"description\":\"" << (PQgetvalue(res, i, 2) ? PQgetvalue(res, i, 2) : "") << "\"}";
        }
    }
    PQclear(res);
    PQfinish(conn);
    json << "]}";
    return json.str();
}
string VIEW_COURSE_INFO(string ID, string JWT, string COURSE_ID) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    const char* params[1] = {COURSE_ID.c_str()};
    PGresult* res = PQexecParams(conn,
        "SELECT name, description, teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
        1, NULL, params, NULL, NULL, 0);
    
    if (PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) == 0) {
        PQclear(res);
        PQfinish(conn);
        return "{\"error\":\"Course not found\"}";
    }
    
    stringstream json;
    json << "{\"name\":\"" << PQgetvalue(res, 0, 0) << "\",";
    json << "\"description\":\"" << (PQgetvalue(res, 0, 1) ? PQgetvalue(res, 0, 1) : "") << "\",";
    json << "\"teacher_id\":\"" << PQgetvalue(res, 0, 2) << "\"}";
    
    PQclear(res);
    PQfinish(conn);
    return json.str();
}
string EDIT_COURSE_INFO(string ID, string JWT, string COURSE_ID, string NEW_NAME, string NEW_DESC) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "course:test:write:own")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    const char* check_params[1] = {COURSE_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Course not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    if (ID != teacher_id) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Обновляем курс
    const char* params[3] = {COURSE_ID.c_str(), NEW_NAME.c_str(), NEW_DESC.c_str()};
    PGresult* res = PQexecParams(conn,
        "UPDATE courses SET name = $2, description = $3 WHERE id = $1 RETURNING name, description",
        3, NULL, params, NULL, NULL, 0);
    
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        PQclear(res);
        PQfinish(conn);
        return "{\"error\":\"Update failed\"}";
    }
    
    stringstream json;
    json << "{\"status\":\"success\",\"name\":\"" << PQgetvalue(res, 0, 0) << "\",";
    json << "\"description\":\"" << PQgetvalue(res, 0, 1) << "\"}";
    
    PQclear(res);
    PQfinish(conn);
    return json.str();
}
string VIEW_COURSE_TESTS(string ID, string JWT, string COURSE_ID) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "course:test:read:self")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем доступ
    const char* check_params[1] = {COURSE_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Course not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    bool is_teacher = (ID == teacher_id);
    bool has_access = is_teacher;
    
    if (!is_teacher) {
        // Проверяем, записан ли на курс
        const char* enroll_params[2] = {ID.c_str(), COURSE_ID.c_str()};
        PGresult* enroll_res = PQexecParams(conn,
            "SELECT COUNT(*) FROM student_courses WHERE student_id = $1 AND course_id = $2",
            2, NULL, enroll_params, NULL, NULL, 0);
        
        if (PQresultStatus(enroll_res) == PGRES_TUPLES_OK) {
            int enrolled = atoi(PQgetvalue(enroll_res, 0, 0));
            has_access = (enrolled > 0) || checkPermission(JWT, "course:test:read:self");
        }
        PQclear(enroll_res);
    }
    
    if (!has_access) {
        PQfinish(conn);
        return "{\"error\":\"No access\"}";
    }
    
    // Получаем тесты
    stringstream json;
    json << "{\"tests\":[";
    PGresult* tests_res = PQexecParams(conn,
        "SELECT id, title FROM tests WHERE course_id = $1 AND NOT is_deleted ORDER BY title",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(tests_res) == PGRES_TUPLES_OK) {
        int num = PQntuples(tests_res);
        for (int i = 0; i < num; i++) {
            if (i > 0) json << ",";
            json << "{\"id\":\"" << PQgetvalue(tests_res, i, 0) << "\",";
            json << "\"title\":\"" << PQgetvalue(tests_res, i, 1) << "\"}";
        }
    }
    PQclear(tests_res);
    PQfinish(conn);
    json << "]}";
    return json.str();
}
string CHECK_TEST_ACTIVE(string ID, string JWT, string COURSE_ID, string TEST_ID) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "test:quest:add:own")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем доступ
    const char* check_params[1] = {COURSE_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Course not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    bool is_teacher = (ID == teacher_id);
    bool has_access = is_teacher;
    
    if (!is_teacher) {
        const char* enroll_params[2] = {ID.c_str(), COURSE_ID.c_str()};
        PGresult* enroll_res = PQexecParams(conn,
            "SELECT COUNT(*) FROM student_courses WHERE student_id = $1 AND course_id = $2",
            2, NULL, enroll_params, NULL, NULL, 0);
        
        if (PQresultStatus(enroll_res) == PGRES_TUPLES_OK) {
            int enrolled = atoi(PQgetvalue(enroll_res, 0, 0));
            has_access = (enrolled > 0) || checkPermission(JWT, "course:test:write:own");
        }
        PQclear(enroll_res);
    }
    
    if (!has_access) {
        PQfinish(conn);
        return "{\"error\":\"No access\"}";
    }
    
    // Проверяем активность теста
    const char* test_params[1] = {TEST_ID.c_str()};
    PGresult* test_res = PQexecParams(conn,
        "SELECT is_active FROM tests WHERE id = $1 AND NOT is_deleted",
        1, NULL, test_params, NULL, NULL, 0);
    
    if (PQresultStatus(test_res) != PGRES_TUPLES_OK || PQntuples(test_res) == 0) {
        PQclear(test_res);
        PQfinish(conn);
        return "{\"error\":\"Test not found\"}";
    }
    
    bool is_active = (strcmp(PQgetvalue(test_res, 0, 0), "t") == 0);
    PQclear(test_res);
    PQfinish(conn);
    
    return "{\"is_active\":" + string(is_active ? "true" : "false") + "}";
}
string TOGGLE_TEST_ACTIVE(string ID, string JWT, string COURSE_ID, string TEST_ID, bool ACTIVATE) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "test:quest:add:own")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем, является ли преподавателем курса
    const char* check_params[1] = {COURSE_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Course not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    if (ID != teacher_id) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Обновляем активность теста
    const char* update_params[2] = {TEST_ID.c_str(), ACTIVATE ? "t" : "f"};
    PGresult* update_res = PQexecParams(conn,
        "UPDATE tests SET is_active = $2 WHERE id = $1 RETURNING is_active",
        2, NULL, update_params, NULL, NULL, 0);
    
    if (PQresultStatus(update_res) != PGRES_TUPLES_OK) {
        PQclear(update_res);
        PQfinish(conn);
        return "{\"error\":\"Update failed\"}";
    }
    
    // Если деактивируем, завершаем все попытки
    if (!ACTIVATE) {
        PQexecParams(conn,
            "UPDATE attempts SET status = 'completed', completed_at = NOW() "
            "WHERE test_id = $1 AND status = 'in_progress'",
            1, NULL, update_params, NULL, NULL, 0);
    }
    
    bool new_status = (strcmp(PQgetvalue(update_res, 0, 0), "t") == 0);
    PQclear(update_res);
    PQfinish(conn);
    
    return "{\"status\":\"success\",\"is_active\":" + string(new_status ? "true" : "false") + "}";
}
string CREATE_TEST(string ID, string JWT, string COURSE_ID, string TITLE) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "test:quest:add:own")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем, является ли преподавателем курса
    const char* check_params[1] = {COURSE_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Course not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    if (ID != teacher_id) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Создаем тест
    string test_id = "test_" + to_string(time(0)) + "_" + to_string(rand() % 1000);
    const char* insert_params[3] = {test_id.c_str(), COURSE_ID.c_str(), TITLE.c_str()};
    PGresult* insert_res = PQexecParams(conn,
        "INSERT INTO tests (id, course_id, title, is_active) VALUES ($1, $2, $3, false) RETURNING id",
        3, NULL, insert_params, NULL, NULL, 0);
    
    if (PQresultStatus(insert_res) != PGRES_TUPLES_OK) {
        PQclear(insert_res);
        PQfinish(conn);
        return "{\"error\":\"Create failed\"}";
    }
    
    string created_id = PQgetvalue(insert_res, 0, 0);
    PQclear(insert_res);
    PQfinish(conn);
    
    return "{\"status\":\"success\",\"test_id\":\"" + created_id + "\"}";
}
string DELETE_TEST(string ID, string JWT, string COURSE_ID, string TEST_ID) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "test:quest:del:own")) {
        return "ERROR 403";
    }
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем, является ли преподавателем курса
    const char* check_params[1] = {COURSE_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Course not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    if (ID != teacher_id) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Мягкое удаление теста
    const char* delete_params[1] = {TEST_ID.c_str()};
    PGresult* delete_res = PQexecParams(conn,
        "UPDATE tests SET is_deleted = true WHERE id = $1 RETURNING id",
        1, NULL, delete_params, NULL, NULL, 0);
    
    if (PQresultStatus(delete_res) != PGRES_TUPLES_OK) {
        PQclear(delete_res);
        PQfinish(conn);
        return "{\"error\":\"Delete failed\"}";
    }
    
    PQclear(delete_res);
    PQfinish(conn);
    return "{\"status\":\"success\"}";
}
string VIEW_COURSE_STUDENTS(string ID, string JWT, string COURSE_ID) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "course:userList:own")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем, является ли преподавателем курса
    const char* check_params[1] = {COURSE_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Course not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    if (ID != teacher_id) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Получаем студентов
    stringstream json;
    json << "{\"students\":[";
    PGresult* stud_res = PQexecParams(conn,
        "SELECT student_id FROM student_courses WHERE course_id = $1 ORDER BY enrolled_at",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(stud_res) == PGRES_TUPLES_OK) {
        int num = PQntuples(stud_res);
        for (int i = 0; i < num; i++) {
            if (i > 0) json << ",";
            json << "\"" << PQgetvalue(stud_res, i, 0) << "\"";
        }
    }
    PQclear(stud_res);
    PQfinish(conn);
    json << "]}";
    return json.str();
}
string ENROLL_STUDENT(string ID, string JWT, string COURSE_ID, string STUDENT_ID) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "course:user:add:others")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    bool self_enroll = (ID == STUDENT_ID);
    bool can_enroll = self_enroll;
    
    if (!self_enroll) {
        // Проверяем, является ли преподавателем курса
        const char* check_params[1] = {COURSE_ID.c_str()};
        PGresult* check_res = PQexecParams(conn,
            "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
            1, NULL, check_params, NULL, NULL, 0);
        
        if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
            PQclear(check_res);
            PQfinish(conn);
            return "{\"error\":\"Course not found\"}";
        }
        
        string teacher_id = PQgetvalue(check_res, 0, 0);
        PQclear(check_res);
        
        can_enroll = (ID == teacher_id);
    }
    
    if (!can_enroll) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Записываем студента
    const char* enroll_params[2] = {STUDENT_ID.c_str(), COURSE_ID.c_str()};
    PGresult* enroll_res = PQexecParams(conn,
        "INSERT INTO student_courses (student_id, course_id) VALUES ($1, $2) "
        "ON CONFLICT DO NOTHING RETURNING student_id",
        2, NULL, enroll_params, NULL, NULL, 0);
    
    if (PQresultStatus(enroll_res) != PGRES_TUPLES_OK) {
        PQclear(enroll_res);
        PQfinish(conn);
        return "{\"error\":\"Enroll failed\"}";
    }
    
    PQclear(enroll_res);
    PQfinish(conn);
    return "{\"status\":\"success\"}";
}
string UNENROLL_STUDENT(string ID, string JWT, string COURSE_ID, string STUDENT_ID) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "course:user:del:others")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    bool self_unenroll = (ID == STUDENT_ID);
    bool can_unenroll = self_unenroll;
    
    if (!self_unenroll) {
        // Проверяем, является ли преподавателем курса
        const char* check_params[1] = {COURSE_ID.c_str()};
        PGresult* check_res = PQexecParams(conn,
            "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
            1, NULL, check_params, NULL, NULL, 0);
        
        if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
            PQclear(check_res);
            PQfinish(conn);
            return "{\"error\":\"Course not found\"}";
        }
        
        string teacher_id = PQgetvalue(check_res, 0, 0);
        PQclear(check_res);
        
        can_unenroll = (ID == teacher_id);
    }
    
    if (!can_unenroll) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Отчисляем студента
    const char* unenroll_params[2] = {STUDENT_ID.c_str(), COURSE_ID.c_str()};
    PGresult* unenroll_res = PQexecParams(conn,
        "DELETE FROM student_courses WHERE student_id = $1 AND course_id = $2 RETURNING student_id",
        2, NULL, unenroll_params, NULL, NULL, 0);
    
    if (PQresultStatus(unenroll_res) != PGRES_TUPLES_OK) {
        PQclear(unenroll_res);
        PQfinish(conn);
        return "{\"error\":\"Unenroll failed\"}";
    }
    
    PQclear(unenroll_res);
    PQfinish(conn);
    return "{\"status\":\"success\"}";
}
string DELETE_COURSE(string ID, string JWT, string COURSE_ID) {
    if (!TOKEN_APPROVED(ID, JWT)){
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "course:user:del:others")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем, является ли преподавателем курса
    const char* check_params[1] = {COURSE_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT teacher_id FROM courses WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Course not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    if (ID != teacher_id) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Мягкое удаление курса
    PGresult* delete_res = PQexecParams(conn,
        "UPDATE courses SET is_deleted = true WHERE id = $1 RETURNING id",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(delete_res) != PGRES_TUPLES_OK) {
        PQclear(delete_res);
        PQfinish(conn);
        return "{\"error\":\"Delete failed\"}";
    }
    
    PQclear(delete_res);
    PQfinish(conn);
    return "{\"status\":\"success\"}";
}
string VIEW_QUESTIONS(string ID, string JWT) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "quest:list:read:self")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    stringstream json;
    json << "{\"questions\":[";
    
    string query;
    if (!checkPermission(JWT, "quest:list:read")) {
        query = 
            "SELECT q.id, qv.title, qv.version, q.author_id FROM questions q "
            "JOIN question_versions qv ON q.id = qv.question_id "
            "WHERE qv.version = (SELECT MAX(version) FROM question_versions WHERE question_id = q.id) "
            "AND NOT q.is_deleted AND q.author_id = $1";
        
        const char* params[1] = {ID.c_str()};
        PGresult* res = PQexecParams(conn, query.c_str(), 1, NULL, params, NULL, NULL, 0);
        
        if (PQresultStatus(res) == PGRES_TUPLES_OK) {
            int num = PQntuples(res);
            for (int i = 0; i < num; i++) {
                if (i > 0) json << ",";
                json << "{\"id\":\"" << PQgetvalue(res, i, 0) << "\",";
                json << "\"title\":\"" << PQgetvalue(res, i, 1) << "\",";
                json << "\"version\":" << PQgetvalue(res, i, 2) << ",";
                json << "\"author_id\":\"" << PQgetvalue(res, i, 3) << "\"}";
            }
        }
        PQclear(res);
    } else {
        query = 
            "SELECT q.id, qv.title, qv.version, q.author_id FROM questions q "
            "JOIN question_versions qv ON q.id = qv.question_id "
            "WHERE qv.version = (SELECT MAX(version) FROM question_versions WHERE question_id = q.id) "
            "AND NOT q.is_deleted";
        
        PGresult* res = PQexec(conn, query.c_str());
        if (PQresultStatus(res) == PGRES_TUPLES_OK) {
            int num = PQntuples(res);
            for (int i = 0; i < num; i++) {
                if (i > 0) json << ",";
                json << "{\"id\":\"" << PQgetvalue(res, i, 0) << "\",";
                json << "\"title\":\"" << PQgetvalue(res, i, 1) << "\",";
                json << "\"version\":" << PQgetvalue(res, i, 2) << ",";
                json << "\"author_id\":\"" << PQgetvalue(res, i, 3) << "\"}";
            }
        }
        PQclear(res);
    }
    
    PQfinish(conn);
    json << "]}";
    return json.str();
}
string VIEW_QUESTION_DETAIL(string ID, string JWT, string QUESTION_ID, int VERSION) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "quest:read:self")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем доступ
    const char* check_params[1] = {QUESTION_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT author_id FROM questions WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Question not found\"}";
    }
    
    string author_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    bool is_author = (ID == author_id);
    bool can_view = is_author;
    
    if (!is_author) {
        // Проверяем, есть ли у студента попытка с этим вопросом
        const char* attempt_params[2] = {ID.c_str(), QUESTION_ID.c_str()};
        PGresult* attempt_res = PQexecParams(conn,
            "SELECT COUNT(*) FROM attempt_answers aa "
            "JOIN attempts a ON aa.attempt_id = a.id "
            "WHERE a.student_id = $1 AND aa.question_id = $2",
            2, NULL, attempt_params, NULL, NULL, 0);
        
        if (PQresultStatus(attempt_res) == PGRES_TUPLES_OK) {
            int has_attempt = atoi(PQgetvalue(attempt_res, 0, 0));
            can_view = (has_attempt > 0);
        }
        PQclear(attempt_res);
    }
    
    if (!can_view) {
        PQfinish(conn);
        return "{\"error\":\"No access\"}";
    }
    
    // Получаем детали вопроса
    const char* version_str = to_string(VERSION).c_str();
    const char* params[2] = {QUESTION_ID.c_str(), version_str};
    PGresult* res = PQexecParams(conn,
        "SELECT title, question_text, options, correct_answer_index FROM question_versions "
        "WHERE question_id = $1 AND version = $2",
        2, NULL, params, NULL, NULL, 0);
    
    if (PQresultStatus(res) != PGRES_TUPLES_OK || PQntuples(res) == 0) {
        PQclear(res);
        PQfinish(conn);
        return "{\"error\":\"Version not found\"}";
    }
    
    string options = PQgetvalue(res, 0, 2);
    
    stringstream json;
    json << "{\"title\":\"" << PQgetvalue(res, 0, 0) << "\",";
    json << "\"question_text\":\"" << PQgetvalue(res, 0, 1) << "\",";
    json << "\"options\":" << options << ",";
    json << "\"correct_answer_index\":" << PQgetvalue(res, 0, 3) << "}";
    
    PQclear(res);
    PQfinish(conn);
    return json.str();
}
string CREATE_QUESTION(string ID, string JWT, string TITLE, string TEXT, string OPTIONS_JSON, int CORRECT_INDEX) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "quest:create")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Создаем вопрос
    string question_id = "q_" + to_string(time(0)) + "_" + to_string(rand() % 1000);
    
    const char* params[2] = {question_id.c_str(), ID.c_str()};
    PGresult* q_res = PQexecParams(conn,
        "INSERT INTO questions (id, author_id) VALUES ($1, $2) RETURNING id",
        2, NULL, params, NULL, NULL, 0);
    
    if (PQresultStatus(q_res) != PGRES_TUPLES_OK) {
        PQclear(q_res);
        PQfinish(conn);
        return "{\"error\":\"Question create failed\"}";
    }
    
    // Создаем первую версию
    const char* v_params[6] = {question_id.c_str(), "1", TITLE.c_str(), TEXT.c_str(), OPTIONS_JSON.c_str(), to_string(CORRECT_INDEX).c_str()};
    PGresult* v_res = PQexecParams(conn,
        "INSERT INTO question_versions (question_id, version, title, question_text, options, correct_answer_index) "
        "VALUES ($1, $2, $3, $4, $5, $6) RETURNING version",
        6, NULL, v_params, NULL, NULL, 0);
    
    if (PQresultStatus(v_res) != PGRES_TUPLES_OK) {
        PQclear(v_res);
        PQclear(q_res);
        PQfinish(conn);
        return "{\"error\":\"Version create failed\"}";
    }
    
    string created_id = PQgetvalue(q_res, 0, 0);
    PQclear(q_res);
    PQclear(v_res);
    PQfinish(conn);
    
    return "{\"status\":\"success\",\"question_id\":\"" + created_id + "\"}";
}
string ADD_QUESTION_TO_TEST(string ID, string JWT, string TEST_ID, string QUESTION_ID) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "{\"error\":\"ERROR 401\"}";
    }
    
    // Подключаемся к БД
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");

    if (PQstatus(conn) != CONNECTION_OK) {
        PQfinish(conn);
        return "{\"error\":\"DB fail\"}";
    }
    
    // 1. Вычисляем порядковый номер вопроса (чтобы он встал в конец)
    const char* count_params[1] = {TEST_ID.c_str()};
    PGresult* count_res = PQexecParams(conn,
        "SELECT COALESCE(MAX(question_order), 0) + 1 FROM test_questions WHERE test_id = $1",
        1, NULL, count_params, NULL, NULL, 0);
    
    string next_order = "1";
    if (PQresultStatus(count_res) == PGRES_TUPLES_OK) {
        next_order = PQgetvalue(count_res, 0, 0);
    }
    PQclear(count_res);
    
    // 2. Связываем вопрос с тестом (Записываем в таблицу test_questions)
    const char* params[3] = {TEST_ID.c_str(), QUESTION_ID.c_str(), next_order.c_str()};
    PGresult* res = PQexecParams(conn,
        "INSERT INTO test_questions (test_id, question_id, question_order) VALUES ($1, $2, $3) RETURNING question_id",
        3, NULL, params, NULL, NULL, 0);
        
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        string err = PQresultErrorMessage(res);
        PQclear(res);
        PQfinish(conn);
        return "{\"error\":\"Link failed: " + err + "\"}";
    }
    
    PQclear(res);
    PQfinish(conn);
    return "{\"status\":\"success\"}";
}

string DELETE_QUESTION(string ID, string JWT, string QUESTION_ID) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "quest:del:self")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем автора
    const char* check_params[1] = {QUESTION_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT author_id FROM questions WHERE id = $1 AND NOT is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Question not found\"}";
    }
    
    string author_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    if (ID != author_id) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Проверяем, используется ли вопрос в тестах
    PGresult* usage_res = PQexecParams(conn,
        "SELECT COUNT(*) FROM test_questions WHERE question_id = $1",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(usage_res) == PGRES_TUPLES_OK) {
        int usage_count = atoi(PQgetvalue(usage_res, 0, 0));
        if (usage_count > 0) {
            PQclear(usage_res);
            PQfinish(conn);
            return "{\"error\":\"Question is used in tests\"}";
        }
    }
    PQclear(usage_res);
    
    // Мягкое удаление
    PGresult* delete_res = PQexecParams(conn,
        "UPDATE questions SET is_deleted = true WHERE id = $1 RETURNING id",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(delete_res) != PGRES_TUPLES_OK) {
        PQclear(delete_res);
        PQfinish(conn);
        return "{\"error\":\"Delete failed\"}";
    }
    
    PQclear(delete_res);
    PQfinish(conn);
    return "{\"status\":\"success\"}";
}
string REMOVE_QUESTION_FROM_TEST(string ID, string JWT, string TEST_ID, string QUESTION_ID) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "test:quest:del:own")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем, является ли преподавателем курса
    const char* check_params[1] = {TEST_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT c.teacher_id FROM tests t "
        "JOIN courses c ON t.course_id = c.id "
        "WHERE t.id = $1 AND NOT t.is_deleted AND NOT c.is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Test not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    if (ID != teacher_id) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Проверяем, были ли попытки
    PGresult* attempt_res = PQexecParams(conn,
        "SELECT COUNT(*) FROM attempts WHERE test_id = $1",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(attempt_res) == PGRES_TUPLES_OK) {
        int attempt_count = atoi(PQgetvalue(attempt_res, 0, 0));
        if (attempt_count > 0) {
            PQclear(attempt_res);
            PQfinish(conn);
            return "{\"error\":\"Test has attempts\"}";
        }
    }
    PQclear(attempt_res);
    
    // Удаляем вопрос из теста
    const char* remove_params[2] = {TEST_ID.c_str(), QUESTION_ID.c_str()};
    PGresult* remove_res = PQexecParams(conn,
        "DELETE FROM test_questions WHERE test_id = $1 AND question_id = $2 RETURNING question_id",
        2, NULL, remove_params, NULL, NULL, 0);
    
    if (PQresultStatus(remove_res) != PGRES_TUPLES_OK) {
        PQclear(remove_res);
        PQfinish(conn);
        return "{\"error\":\"Remove failed\"}";
    }
    
    PQclear(remove_res);
    PQfinish(conn);
    return "{\"status\":\"success\"}";
}
string VIEW_TEST_ATTEMPTS(string ID, string JWT, string TEST_ID) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "test:answer:read:others")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) return "{\"error\":\"DB fail\"}";
    
    // Проверяем, является ли преподавателем курса
    const char* check_params[1] = {TEST_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT c.teacher_id FROM tests t "
        "JOIN courses c ON t.course_id = c.id "
        "WHERE t.id = $1 AND NOT t.is_deleted AND NOT c.is_deleted",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Test not found\"}";
    }
    
    string teacher_id = PQgetvalue(check_res, 0, 0);
    PQclear(check_res);
    
    if (ID != teacher_id) {
        PQfinish(conn);
        return "{\"error\":\"No permission\"}";
    }
    
    // Получаем попытки
    stringstream json;
    json << "{\"attempts\":[";
    PGresult* res = PQexecParams(conn,
        "SELECT student_id, score, percentage, status FROM attempts WHERE test_id = $1 ORDER BY completed_at DESC",
        1, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(res) == PGRES_TUPLES_OK) {
        int num = PQntuples(res);
        for (int i = 0; i < num; i++) {
            if (i > 0) json << ",";
            json << "{\"student_id\":\"" << PQgetvalue(res, i, 0) << "\",";
            json << "\"score\":" << (PQgetvalue(res, i, 1) ? PQgetvalue(res, i, 1) : "null") << ",";
            json << "\"percentage\":" << (PQgetvalue(res, i, 2) ? PQgetvalue(res, i, 2) : "null") << ",";
            json << "\"status\":\"" << PQgetvalue(res, i, 3) << "\"}";
        }
    }
    PQclear(res);
    PQfinish(conn);
    json << "]}";
    return json.str();
}
string CREATE_ATTEMPT(string ID, string JWT, string TEST_ID) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "{\"error\":\"ERROR 401: Token invalid or expired\"}";
    }
    
    if (!checkPermission(JWT, "attempt:create:self")) {
        return "{\"error\":\"ERROR 403: No permission\"}";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");
        
    if (PQstatus(conn) != CONNECTION_OK) {
        string err = PQerrorMessage(conn);
        PQfinish(conn);
        return "{\"error\":\"DB fail: " + err + "\"}";
    }
    
    // 1. Проверяем, активен ли тест
    const char* test_params[1] = {TEST_ID.c_str()};
    PGresult* test_res = PQexecParams(conn,
        "SELECT is_active FROM tests WHERE id = $1 AND NOT is_deleted",
        1, NULL, test_params, NULL, NULL, 0);
    
    if (PQresultStatus(test_res) != PGRES_TUPLES_OK || PQntuples(test_res) == 0) {
        PQclear(test_res);
        PQfinish(conn);
        return "{\"error\":\"Test not found (Check Test ID)\"}";
    }
    
    bool is_active = (strcmp(PQgetvalue(test_res, 0, 0), "t") == 0);
    PQclear(test_res);
    
    if (!is_active) {
        PQfinish(conn);
        return "{\"error\":\"Test is not active\"}";
    }
    
    // 2. Проверяем, есть ли уже попытка
    const char* check_params[2] = {ID.c_str(), TEST_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT id FROM attempts WHERE student_id = $1 AND test_id = $2",
        2, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) == PGRES_TUPLES_OK && PQntuples(check_res) > 0) {
        string attempt_id = PQgetvalue(check_res, 0, 0);
        PQclear(check_res);
        PQfinish(conn);
        // Возвращаем ID существующей попытки, чтобы фронт мог продолжить
        return "{\"status\":\"success\",\"attempt_id\":" + attempt_id + "}";
    }
    PQclear(check_res);
    
    // 3. Создаем попытку (С ДЕТАЛЬНЫМ ВЫВОДОМ ОШИБКИ)
    PGresult* attempt_res = PQexecParams(conn,
        "INSERT INTO attempts (student_id, test_id, status) VALUES ($1, $2, 'in_progress') RETURNING id",
        2, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(attempt_res) != PGRES_TUPLES_OK) {
        string dbErr = PQresultErrorMessage(attempt_res);
        
        // Убираем переносы строк и кавычки, чтобы не сломать JSON
        for(char &c : dbErr) {
            if(c == '\n' || c == '\r') c = ' ';
            if(c == '"') c = '\'';
        }
        
        cout << "SQL ERROR in CREATE_ATTEMPT: " << dbErr << endl; // Пишем в консоль сервера
        
        PQclear(attempt_res);
        PQfinish(conn);
        return "{\"error\":\"Create attempt failed: " + dbErr + "\"}";
    }
    
    string attempt_id = PQgetvalue(attempt_res, 0, 0);
    PQclear(attempt_res);
    
    PGresult* questions_res = PQexecParams(conn,
        "SELECT tq.question_id, qv.version FROM test_questions tq "
        "JOIN question_versions qv ON tq.question_id = qv.question_id "
        "WHERE tq.test_id = $1 AND qv.version = (SELECT MAX(version) FROM question_versions WHERE question_id = tq.question_id) "
        "ORDER BY tq.question_order",
        1, NULL, test_params, NULL, NULL, 0);
    
    if (PQresultStatus(questions_res) == PGRES_TUPLES_OK) {
        int num = PQntuples(questions_res);
        for (int i = 0; i < num; i++) {
            const char* ans_params[3] = {attempt_id.c_str(), 
                                       PQgetvalue(questions_res, i, 0),
                                       PQgetvalue(questions_res, i, 1)};
            // Игнорируем ошибки вставки ответов, главное попытка создана
            PGresult* ins = PQexecParams(conn,
                "INSERT INTO attempt_answers (attempt_id, question_id, question_version, selected_answer_index) "
                "VALUES ($1, $2, $3, -1)",
                3, NULL, ans_params, NULL,
NULL, 0);
            PQclear(ins);
        }
    }
    PQclear(questions_res);
    PQfinish(conn);
    
    return "{\"status\":\"success\",\"attempt_id\":" + attempt_id + "}";
}
string VIEW_ATTEMPT(string ID, string JWT, string TEST_ID) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "{\"error\":\"ERROR 401\"}";
    }
    
    if (!checkPermission(JWT, "attempt:read:self")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech "
        "port=5432 "
        "dbname=neondb "
        "user=neondb_owner "
        "password=npg_tTdv0G5elYum "
        "sslmode=require");

    if (PQstatus(conn) != CONNECTION_OK) {
        PQfinish(conn);
        return "{\"error\":\"DB fail\"}";
    }
    
    const char* check_params[2] = {ID.c_str(), TEST_ID.c_str()};
    PGresult* check_res = PQexecParams(conn,
        "SELECT a.id, c.teacher_id FROM attempts a "
        "JOIN tests t ON a.test_id = t.id "
        "JOIN courses c ON t.course_id = c.id "
        "WHERE a.student_id = $1 AND a.test_id = $2",
        2, NULL, check_params, NULL, NULL, 0);
    
    if (PQresultStatus(check_res) != PGRES_TUPLES_OK || PQntuples(check_res) == 0) {
        PQclear(check_res);
        PQfinish(conn);
        return "{\"error\":\"Attempt not found\"}";
    }
    
    string attempt_id = PQgetvalue(check_res, 0, 0);
    string teacher_id = PQgetvalue(check_res, 0, 1);
    
    PQclear(check_res);
    
    stringstream json;
    json << "{\"answers\":[";
    const char* attempt_params[1] = {attempt_id.c_str()};
    PGresult* answers_res = PQexecParams(conn,
        "SELECT question_id, selected_answer_index FROM attempt_answers WHERE attempt_id = $1 ORDER BY id",
        1, NULL, attempt_params, NULL, NULL, 0);
    
    if (PQresultStatus(answers_res) == PGRES_TUPLES_OK) {
        int num = PQntuples(answers_res);
        for (int i = 0; i < num; i++) {
            if (i > 0) json << ",";
            json << "{\"question_id\":\"" << PQgetvalue(answers_res, i, 0) << "\",";
            json << "\"answer_index\":" << PQgetvalue(answers_res, i, 1) << "}";
        }
    }
    PQclear(answers_res);
    
    PGresult* status_res = PQexecParams(conn,
        "SELECT status FROM attempts WHERE id = $1",
        1, NULL, attempt_params, NULL, NULL, 0);
    
    if (PQresultStatus(status_res) == PGRES_TUPLES_OK) {
        json << "],\"status\":\"" << PQgetvalue(status_res, 0, 0) << "\"}";
    } else {
        json << "],\"status\":\"unknown\"}";
    }
    
    PQclear(status_res);
    PQfinish(conn);
    
    return json.str();
}

string UPDATE_ANSWER(string ID, string JWT, string ATTEMPT_ID, string QUESTION_ID, int ANSWER_INDEX) {
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    if (!checkPermission(JWT, "answer:update:self")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech port=5432 dbname=neondb user=neondb_owner password=npg_tTdv0G5elYum sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) { PQfinish(conn); return "{\"error\":\"DB fail\"}"; }
    
    // Мы ищем запись по ID попытки и ID вопроса.
    const char* params[3] = {to_string(ANSWER_INDEX).c_str(), ATTEMPT_ID.c_str(), QUESTION_ID.c_str()};
    
    PGresult* res = PQexecParams(conn,
        "UPDATE attempt_answers SET selected_answer_index = $1, answered_at = NOW() "
        "WHERE attempt_id = $2 AND question_id = $3 "
        "RETURNING id",
        3, NULL, params, NULL, NULL, 0);
        
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        string err = PQresultErrorMessage(res);
        cout << "SQL ERROR in UPDATE_ANSWER: " << err << endl; // ЛОГ ОШИБКИ
        PQclear(res);
        PQfinish(conn);
        return "{\"error\":\"Update failed: " + err + "\"}";
    }
    
    // Проверяем, обновилось ли хоть что-то
    if (PQntuples(res) == 0) {
        cout << "WARNING: Answer not updated! (Maybe wrong question_id?)" << endl;
        PQclear(res);
        PQfinish(conn);
        // Не возвращаем ошибку, чтобы фронт не падал, но пишем в лог
        return "{\"status\":\"warning_no_row_updated\"}";
    }
    
    PQclear(res);
    PQfinish(conn);
    return "{\"status\":\"success\"}";
}

string COMPLETE_ATTEMPT(string ID, string JWT, string ATTEMPT_ID) {
    if (!TOKEN_APPROVED(ID, JWT)){ 
        return "ERROR 401";
    }
    if (!checkPermission(JWT, "attempt:complete:self")) {
        return "ERROR 403";
    }
    
    PGconn* conn = PQconnectdb("host=ep-snowy-truth-ah9dp5ai-pooler.c-3.us-east-1.aws.neon.tech port=5432 dbname=neondb user=neondb_owner password=npg_tTdv0G5elYum sslmode=require");
    if (PQstatus(conn) != CONNECTION_OK) { PQfinish(conn); return "{\"error\":\"DB fail\"}"; }
    
    // 1. Считаем баллы
    const char* p[1] = {ATTEMPT_ID.c_str()};
    
    PGresult* calc_res = PQexecParams(conn,
        "SELECT COUNT(*), "
        "SUM(CASE WHEN aa.selected_answer_index = qv.correct_answer_index THEN 1 ELSE 0 END) "
        "FROM attempt_answers aa "
        "JOIN question_versions qv ON aa.question_id = qv.question_id AND aa.question_version = qv.version "
        "WHERE aa.attempt_id = $1",
        1, NULL, p, NULL, NULL, 0);
        
    int total = 0;
    int correct = 0;
    
    if (PQresultStatus(calc_res) == PGRES_TUPLES_OK) {
        if (PQgetvalue(calc_res, 0, 0)) total = atoi(PQgetvalue(calc_res, 0, 0));
        if (PQgetvalue(calc_res, 0, 1)) correct = atoi(PQgetvalue(calc_res, 0, 1));
    } else {
        cout << "SQL CALC ERROR: " << PQresultErrorMessage(calc_res) << endl;
    }
    PQclear(calc_res);
    
    // ЗАЩИТА ОТ ДЕЛЕНИЯ НА НОЛЬ
    int percent = (total > 0) ? (correct * 100 / total) : 0;
    
    cout << "Grading attempt " << ATTEMPT_ID << ": " << correct << "/" << total << " (" << percent << "%)" << endl;
    
    // 2. Записываем результат
    const char* up_params[4] = {
        to_string(correct).c_str(),
        to_string(total).c_str(),
        to_string(percent).c_str(),
        ATTEMPT_ID.c_str()
    };
    
    PGresult* res = PQexecParams(conn,
        "UPDATE attempts SET status = 'completed', completed_at = NOW(), "
        "score = $1, max_score = $2, percentage = $3 "
        "WHERE id = $4 RETURNING id",
        4, NULL, up_params, NULL, NULL, 0);
        
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        string err = PQresultErrorMessage(res);
        cout << "SQL UPDATE ERROR: " << err << endl;
        PQclear(res);
        PQfinish(conn);
        return "{\"error\":\"Save grade failed: " + err + "\"}";
    }
    
    PQclear(res);
    PQfinish(conn);
    
    // Возвращаем JSON с результатом
    return "{\"status\":\"success\", \"score\":" + to_string(correct) + ", \"max_score\":" + to_string(total) + "}";
}


int main(){
    httplib::Server svr;
    svr.Get("/task", [](const httplib::Request& req, httplib::Response& res) {
        string ID = req.get_param_value("ID");
        string JWT = req.get_param_value("JWT");
        string ACTION = req.get_param_value("Action");
        string NEW_NAME = req.get_param_value("New_name");
        string NEW_LASTNAME = req.get_param_value("New_lastname");
        string TARGET_ID = req.get_param_value("Target_ID");
        string TARGET_ROLE = req.get_param_value("Target_ROLE");
        string COURSE_NAME = req.get_param_value("Course_NAME");
        string DESCRIPTION = req.get_param_value("Description");
        string COURSE_ID = req.get_param_value("Course_ID");
        string TEST_ID = req.get_param_value("Test_ID");
        string QUESTION_ID = req.get_param_value("Question_ID");
        string ATTEMPT_ID = req.get_param_value("Attempt_ID");
        string TITLE = req.get_param_value("Title");
        string TEXT = req.get_param_value("Text");
        string OPTIONS_JSON = req.get_param_value("Options");
        string ANSWER_INDEX_STR = req.get_param_value("Answer_Index");
        string ACTIVATE_STR = req.get_param_value("Activate");
        string VERSION_STR = req.get_param_value("Version");
    
    cout << "\n========================================" << endl;
    cout << "Incoming request to /task" << endl;
    cout << "Action: " << ACTION << endl;
    cout << "ID: " << ID << endl;
    cout << "Target_ID: " << TARGET_ID << endl;
    
    string result;
    string blocked;
    
    if (ACTION == "VIEW_OWN_NAME") {
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
         result = VIEW_OWN_NAME(ID, JWT);
        }
    }
    else if (ACTION == "VIEW_OTHER_NAME") {
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_OTHER_NAME(ID, TARGET_ID, JWT);
        }
    }
    else if (ACTION == "VIEW_OTHER_ROLES") {
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_OTHER_ROLES(ID, TARGET_ID, JWT);
        }
    }
    else if (ACTION == "ADD_QUESTION_TO_TEST"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = ADD_QUESTION_TO_TEST(ID, JWT, TEST_ID, QUESTION_ID);
        }
    }
    else if (ACTION == "EDIT_OWN_NAME"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = EDIT_OWN_NAME(ID, JWT, NEW_NAME, NEW_LASTNAME);
        }
    } 
    else if (ACTION == "EDIT_OTHER_NAME"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = EDIT_OTHER_NAME(ID, TARGET_ID, JWT, NEW_NAME, NEW_LASTNAME);
        }
    } 
    else if (ACTION == "VIEW_ALL_USERS"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_ALL_USERS(ID, JWT);
        }
    }
    else if (ACTION == "EDIT_OTHER_ROLES"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = EDIT_OTHER_ROLES(ID, TARGET_ID, TARGET_ROLE, JWT);
        }
    }
    else if (ACTION == "VIEW_BLOCKED"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_BLOCKED(ID, TARGET_ID, JWT);
        }
    }
    else if (ACTION == "EDIT_BLOCKED"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = EDIT_BLOCKED(ID, TARGET_ID, ACTION, JWT);
        }
    }
    else if (ACTION == "VIEW_OWN_DATA"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_OWN_DATA(ID,JWT);
        }
    }
    else if (ACTION == "VIEW_OTHER_DATA"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_OTHER_DATA(ID,TARGET_ID,JWT);
        }
    }
    else if (ACTION == "CREATE_COURSE"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = CREATE_COURSE(ID,JWT,COURSE_NAME,DESCRIPTION,TARGET_ID);
        }
    }
    else if (ACTION == "VIEW_ALL_COURSES"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_ALL_COURSES(ID,JWT);
        }
    }
    else if (ACTION == "VIEW_COURSE_INFO"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_COURSE_INFO(ID,JWT,COURSE_ID);
        }
    }
    else if (ACTION == "EDIT_COURSE_INFO"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = EDIT_COURSE_INFO(ID,JWT,COURSE_ID,COURSE_NAME,DESCRIPTION);
        }
    }
    else if (ACTION == "VIEW_COURSE_TESTS"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_COURSE_TESTS(ID,JWT,COURSE_ID);
        }
    }
    else if (ACTION == "CHECK_TEST_ACTIVE"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = CHECK_TEST_ACTIVE(ID,JWT,COURSE_ID,TEST_ID);
        }
    }
    else if (ACTION == "TOGGLE_TEST_ACTIVE"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            bool activate = (ACTIVATE_STR == "true" || ACTIVATE_STR == "1");
            result = TOGGLE_TEST_ACTIVE(ID,JWT,COURSE_ID,TEST_ID,activate);
        }
    }
    else if (ACTION == "CREATE_TEST"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = CREATE_TEST(ID,JWT,COURSE_ID,TITLE);
        }
    }
    else if (ACTION == "DELETE_TEST"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = DELETE_TEST(ID,JWT,COURSE_ID,TEST_ID);
        }
    }
    else if (ACTION == "VIEW_COURSE_STUDENTS"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_COURSE_STUDENTS(ID,JWT,COURSE_ID);
        }
    }
    else if (ACTION == "ENROLL_STUDENT"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = ENROLL_STUDENT(ID,JWT,COURSE_ID,TARGET_ID);
        }
    }
    else if (ACTION == "UNENROLL_STUDENT"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = UNENROLL_STUDENT(ID,JWT,COURSE_ID,TARGET_ID);
        }
    }
    else if (ACTION == "DELETE_COURSE"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = DELETE_COURSE(ID,JWT,COURSE_ID);
        }
    }
    else if (ACTION == "VIEW_QUESTIONS"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_QUESTIONS(ID,JWT);
        }
    }
    else if (ACTION == "VIEW_QUESTION_DETAIL"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            int version = VERSION_STR.empty() ? 1 : stoi(VERSION_STR);
            result = VIEW_QUESTION_DETAIL(ID,JWT,QUESTION_ID,version);
        }
    }
    else if (ACTION == "CREATE_QUESTION"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            int correct_index = ANSWER_INDEX_STR.empty() ? 0 : stoi(ANSWER_INDEX_STR);
            result = CREATE_QUESTION(ID,JWT,TITLE,TEXT,OPTIONS_JSON,correct_index);
        }
    }
    else if (ACTION == "DELETE_QUESTION"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = DELETE_QUESTION(ID,JWT,QUESTION_ID);
        }
    }
    else if (ACTION == "REMOVE_QUESTION_FROM_TEST"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = REMOVE_QUESTION_FROM_TEST(ID,JWT,TEST_ID,QUESTION_ID);
        }
    }
    else if (ACTION == "VIEW_TEST_ATTEMPTS"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_TEST_ATTEMPTS(ID,JWT,TEST_ID);
        }
    }
    else if (ACTION == "CREATE_ATTEMPT"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = CREATE_ATTEMPT(ID,JWT,TEST_ID);
        }
    }
    else if (ACTION == "VIEW_ATTEMPT"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = VIEW_ATTEMPT(ID,JWT,TEST_ID);
        }
    }
    else if (ACTION == "UPDATE_ANSWER"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            int answer_index = ANSWER_INDEX_STR.empty() ? -1 : stoi(ANSWER_INDEX_STR);
            result = UPDATE_ANSWER(ID,JWT,ATTEMPT_ID,QUESTION_ID,answer_index);
        }
    }
    else if (ACTION == "COMPLETE_ATTEMPT"){
        string blocked = VIEW_BLOCKED(ID, ID, JWT);
        if (blocked.find("true") != string::npos) {
            result = "ERROR 418: User is blocked";
        } else {
            result = COMPLETE_ATTEMPT(ID,JWT,ATTEMPT_ID);
        }
    }
    else {
        result = "ERROR 400: Unknown action: " + ACTION;
    }
        
        res.set_content(result, "text/plain");
        cout << "Response sent" << endl;
        cout << "========================================\n" << endl;
});
    
    cout << "C++ Server starting on port 8081..." << endl;
    cout << "Connecting to Go server at: " << GO_SERVER_URL << endl;
    cout << "Test endpoints:" << endl;
    cout << "1. http://localhost:8081/ping" << endl;
    cout << "2. http://localhost:8081/task?Action=VIEW_OWN_NAME&ID=test&JWT=token" << endl;
    
    try {
        svr.listen("0.0.0.0", 8081);
    } catch (const exception& e) {
        cerr << "Server error: " << e.what() << endl;
        return 1;
    }
    
    return 0;
}