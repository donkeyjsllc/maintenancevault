const { CognitoIdentityProviderClient, AdminDeleteUserCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");

const cognitoClient = new CognitoIdentityProviderClient({ region: "us-east-1" });
const dbClient = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(dbClient);

// UPDATE WITH YOUR ACTUAL COGNITO USER POOL ID
const USER_POOL_ID = "us-east-1_c9WukUWbT"; 

exports.handler = async (event) => {
    const httpMethod = event.httpMethod;

    // 1. THE FIX: Handle the browser's invisible CORS Preflight check
    if (httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "OPTIONS,POST,GET,DELETE",
                "Access-Control-Allow-Headers": "Content-Type,Authorization"
            },
            body: JSON.stringify({ message: "CORS preflight successful" })
        };
    }

    // 2. Extract User Identity from the Cognito Authorization context token
    const userId = event.requestContext?.authorizer?.claims?.username || event.requestContext?.authorizer?.claims?.["cognito:username"];
    if (!userId) {
        return { statusCode: 401, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ message: "Unauthorized" }) };
    }

    try {
        if (httpMethod === "DELETE") {
            // Scan DynamoDB and fetch all logs matching this user
            const scanParams = {
                TableName: "MaintenanceVault-Items",
                FilterExpression: "userId = :uid",
                ExpressionAttributeValues: { ":uid": userId }
            };
            const records = await docClient.send(new ScanCommand(scanParams));

            // Erase each individual log record from DynamoDB
            for (const record of records.Items || []) {
                await docClient.send(new DeleteCommand({
                    TableName: "MaintenanceVault-Items",
                    Key: { itemId: record.itemId }
                }));
            }

            // Fire Admin command to purge the profile from Cognito
            await cognitoClient.send(new AdminDeleteUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: userId
            }));

            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ message: "Account and records purged successfully." })
            };
        }
        
        // This handles standard POST requests (saving items & saving feedback)
        if (httpMethod === "POST") {
            const body = JSON.parse(event.body);
            for (const item of body) {
                await docClient.send(new PutCommand({
                    TableName: "MaintenanceVault-Items",
                    Item: { ...item, userId: userId }
                }));
            }
            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ message: "Data synced successfully." })
            };
        }

        // This handles GET requests (pulling data to the app)
        if (httpMethod === "GET") {
            const scanParams = {
                TableName: "MaintenanceVault-Items",
                FilterExpression: "userId = :uid",
                ExpressionAttributeValues: { ":uid": userId }
            };
            const records = await docClient.send(new ScanCommand(scanParams));
            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify(records.Items || [])
            };
        }
        
        return { statusCode: 405, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ message: "Method Not Allowed" }) };
    } catch (error) {
        console.error("Operation failure:", error);
        return {
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ message: "Internal Error", error: error.message })
        };
    }
};
