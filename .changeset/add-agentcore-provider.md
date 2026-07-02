---
"@computesdk/agentcore": patch
---

Add AWS Bedrock AgentCore Code Interpreter provider. Maps a ComputeSDK sandbox onto an AgentCore Code Interpreter session, with command execution and filesystem support. Authenticates via the standard AWS credential provider chain (environment variables, SSO, named profiles, instance roles), so temporary credentials and profiles work out of the box.
