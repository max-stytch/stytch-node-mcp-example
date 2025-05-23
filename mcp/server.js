import express from "express";
import cors from 'cors'
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import dotenv from "dotenv";
import {Client} from "stytch";


dotenv.config({ path: '.env.local' });

const client = new Client({
  project_id: process.env.STYTCH_PROJECT_ID,
  secret: process.env.STYTCH_SECRET
});

const authorizeTokenMiddleware = () => {
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization && req.headers.authorization.split(' ')[1];
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const response = await client.idp.introspectTokenLocal(token);
      console.log(response);
      req.user = response;
      next();
    } catch (error) {
      console.error('Error in middleware:', error);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
};


const app = express();

// Apply CORS middleware
app.use(cors({
  origin: '*', // You should replace this with your specific allowed origins in production
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400 // 24 hours
}));
app.use(express.json());

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  return res.json({
    "issuer": process.env.STYTCH_PROJECT_ID,
    "authorization_endpoint": "http://localhost:3001/oauth/authorize",
    "token_endpoint": `https://test.stytch.com/v1/public/${process.env.STYTCH_PROJECT_ID}/oauth2/token`,
    "registration_endpoint": `https://test.stytch.com/v1/public/${process.env.STYTCH_PROJECT_ID}/oauth2/register`,
    "scopes_supported": [
      "openid",
      "profile",
      "email",
      "offline_access"
    ],
    "response_types_supported": [
      "code"
    ],
    "response_modes_supported": [
      "query"
    ],
    "grant_types_supported": [
      "authorization_code",
      "refresh_token"
    ],
    "token_endpoint_auth_methods_supported": [
      "none"
    ],
    "code_challenge_methods_supported": [
      "S256"
    ]
  })
})
app.post('/mcp', authorizeTokenMiddleware(), async (req, res) => {
  // In stateless mode, create a new instance of transport and server for each request
  // to ensure complete isolation. A single instance would cause request ID collisions
  // when multiple clients connect concurrently.

  try {
    const server = getServer(req);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      console.log('Request closed');
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});


// Start the server
const PORT = 3005;
app.listen(PORT, () => {
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});

function getServer(req) {
  // Create an MCP server
  const server = new McpServer({
    name: "Demo",
    version: "1.0.0"
  });

// Add an addition tool
  server.tool("add",
    { a: z.number(), b: z.number() },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }]
    })
  );

  server.tool("whoami", {}, async () => ({
    content: [{ type: "text", text: "You are " + JSON.stringify(req.user, null, 2) }]
  }));

  return server
}