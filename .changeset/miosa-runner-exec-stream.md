---
"@computesdk/miosa": patch
---

Run runner execs over exec/stream instead of buffered exec, and wait for the sandbox to report ready first. The buffered request dies on the transport's 30s deadline no matter the command's own timeout, so installs and builds read as failures and the abandoned server-side exec then refuses destroy with SANDBOX_BUSY. Runner create also answers while the machine is still launching — an exec sent mid-launch parks in a server-side hold that drops the stream before the command runs — so exec now polls the sandbox's state until it is ready (a 404 while it comes up just means the record is not attached yet). Also retry a SANDBOX_BUSY destroy briefly: it is a refusal while a lifecycle op drains, not an attempted delete, so a bounded retry turns the drain window into a clean teardown instead of a leaked sandbox.

Fold the exec stream's real wire shape: output frames arrive as flat {"text":"<chunk>"} objects (a merged stream — the {type,line} union in the SDK's declaration does not match the wire), and the terminal frame is any payload carrying an exit_code/exitCode rather than only type:"exit". Output and exit codes now reach the caller instead of reading as "stream ended without an exit event".
