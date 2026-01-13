#define _WIN32_WINNT 0x0A00
#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <chrono>
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
        
        // Проверяем expiration
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
    cout << "\n=== VIEW_OWN_NAME called ===" << endl;
    
    if (!TOKEN_APPROVED(ID, JWT)) {
        return "ERROR 401";
    }
    
    try {
        auto decoded = jwt::decode(JWT);
        string first_name = "";
        string last_name = "";
        
        try {
            first_name = decoded.get_payload_claim("first_name").as_string();
        } catch(...) {}
        
        try {
            last_name = decoded.get_payload_claim("last_name").as_string();
        } catch(...) {}
        
        if (first_name.empty() && last_name.empty()) {
            return "ERROR 401";
        }
        
        string result = first_name + " " + last_name;
        if (first_name.empty()) result = last_name;
        if (last_name.empty()) result = first_name;
        
        cout << "Returning: " << result << endl;
        return result;
    } catch (...) {
        cout << "Error decoding JWT in VIEW_OWN_NAME" << endl;
        return "ERROR 401";
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
        httplib::Params params = {{
            {"ID", TARGET_ID}
        }};
        
        auto response = client.Get("/api/user/blocked", params, headers);
        
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
        
        cout << "\n========================================" << endl;
        cout << "Incoming request to /task" << endl;
        cout << "Action: " << ACTION << endl;
        cout << "ID: " << ID << endl;
        cout << "Target_ID: " << TARGET_ID << endl;
        
        string result;
        
        if (ACTION == "VIEW_OWN_NAME") {
            result = VIEW_OWN_NAME(ID, JWT);
        } 
        else if (ACTION == "VIEW_OTHER_NAME") {
            result = VIEW_OTHER_NAME(ID, TARGET_ID, JWT);
        }
        else if (ACTION == "VIEW_OTHER_ROLES") {
            result = VIEW_OTHER_ROLES(ID, TARGET_ID, JWT);
        }
        else if (ACTION == "EDIT_OWN_NAME"){
            result = EDIT_OWN_NAME(ID, JWT, NEW_NAME, NEW_LASTNAME);
        } 
        else if (ACTION == "EDIT_OTHER_NAME"){
            result = EDIT_OTHER_NAME(ID, TARGET_ID, JWT, NEW_NAME, NEW_LASTNAME);
        } 
        else if (ACTION == "VIEW_ALL_USERS"){
            result = VIEW_ALL_USERS(ID, JWT);
        }
        else if (ACTION == "EDIT_OTHER_ROLES"){
            result = EDIT_OTHER_ROLES(ID, TARGET_ID, TARGET_ROLE, JWT);
        }
        else if (ACTION == "VIEW_BLOCKED"){
            result = VIEW_BLOCKED(ID, TARGET_ID, JWT);
        }
        else if (ACTION == "EDIT_BLOCKED"){
            result = EDIT_BLOCKED(ID, TARGET_ID, ACTION, JWT);
        }
        else {
            result = "ERROR 400: Unknown action: " + ACTION;
        }
        
        res.set_content(result, "text/plain");
        cout << "Response sent: " << result << endl;
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