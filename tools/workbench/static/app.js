// Import SDK from CDN
import { ComputeClient } from 'https://unpkg.com/computesdk@latest/dist/index.js';

// Load and save API URL from localStorage
const apiUrlInput = document.getElementById('api-url');
const savedApiUrl = localStorage.getItem('apiUrl');
if (savedApiUrl) {
    apiUrlInput.value = savedApiUrl;
}

apiUrlInput.addEventListener('change', () => {
    localStorage.setItem('apiUrl', apiUrlInput.value);
});

function getApiUrl() {
    return apiUrlInput.value;
}

// Initialize SDK client
const client = new ComputeClient({
    baseURL: getApiUrl()
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        
        // Update active states
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(tabId).classList.add('active');
    });
});

// API Tester
document.getElementById('send-request').addEventListener('click', async () => {
    const method = document.getElementById('method').value;
    const endpoint = document.getElementById('endpoint').value;
    const body = document.getElementById('request-body').value;
    const output = document.getElementById('response-output');
    
    try {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            }
        };
        
        if (method !== 'GET' && body) {
            options.body = body;
        }
        
        output.textContent = 'Loading...';
        
        // Use configured API URL
        const response = await fetch(`${getApiUrl()}${endpoint}`, options);
        const data = await response.json();
        
        output.textContent = JSON.stringify(data, null, 2);
    } catch (error) {
        output.textContent = `Error: ${error.message}`;
    }
});

// Compute Manager
async function loadComputes() {
    const computeList = document.getElementById('compute-list');
    computeList.innerHTML = '<p>Click "Create Compute" to start a new instance</p><button id="create-compute">Create Compute</button>';
    
    document.getElementById('create-compute').addEventListener('click', async () => {
        try {
            computeList.innerHTML = '<p>Creating compute instance...</p>';
            const compute = await client.create();
            
            computeList.innerHTML = `
                <div class="compute-item">
                    <h3>Compute Instance</h3>
                    <p>ID: ${compute.id || 'Active'}</p>
                    <p>Status: Connected</p>
                    <button onclick="window.currentCompute = compute; document.querySelector('[data-tab=terminal]').click()">Open Terminal</button>
                </div>
            `;
            
            // Store compute instance globally for terminal access
            window.currentCompute = compute;
            
            // Listen for server ready events
            compute.onServerReady((port, url) => {
                console.log(`Server ready on port ${port}: ${url}`);
            });
        } catch (error) {
            computeList.innerHTML = `<p>Error creating compute: ${error.message}</p>`;
        }
    });
}

// Load computes when tab is activated
document.querySelector('[data-tab="compute-manager"]').addEventListener('click', loadComputes);

// Terminal setup
let terminal = null;
let fitAddon = null;

// Console logging utilities
function log(message, type = 'info', targetId = 'console-output') {
    const consoleDiv = document.getElementById(targetId);
    const div = document.createElement('div');
    div.className = `log ${type}`;
    div.textContent = message;
    consoleDiv.appendChild(div);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
    console.log(`[${type}] ${message}`);
}

// Terminal functionality
let activeTerminal = null;

function initTerminal() {
    if (!window.currentCompute) {
        document.getElementById('console-output').innerHTML = '<p style="color: #ff6b6b;">No compute instance active. Go to Compute Manager to create one.</p>';
        return;
    }

    // Set up command input
    const commandInput = document.getElementById('command-input');
    const sendButton = document.getElementById('send-command');

    sendButton.onclick = sendCommand;
    commandInput.onkeypress = (e) => {
        if (e.key === 'Enter') sendCommand();
    };

    // Initialize terminal if not already done
    if (!activeTerminal) {
        setupTerminal();
    }
}

async function setupTerminal() {
    try {
        log('🖥️ Creating terminal...', 'info');
        const terminal = await window.currentCompute.createTerminal();
        
        if (!terminal) {
            throw new Error('Terminal creation failed');
        }

        activeTerminal = terminal;
        log('✅ Terminal ready!', 'success');

        terminal.onData((data) => {
            log(data, 'info');
        });

        terminal.onExit(({ exitCode, signal }) => {
            log(`🚪 Terminal exited with code ${exitCode} ${signal ? `(signal: ${signal})` : ''}`, 'info');
            activeTerminal = null;
        });

        // Welcome commands
        terminal.write('echo "Welcome to ComputeSDK Terminal! 🚀"\n');
        terminal.write('echo "Try: echo Hello > test.txt"\n');
        
    } catch (error) {
        log(`❌ Terminal error: ${error.message}`, 'error');
    }
}

function sendCommand() {
    const commandInput = document.getElementById('command-input');
    const command = commandInput.value;

    if (activeTerminal && command) {
        log(`🎮 $ ${command}`, 'info');
        activeTerminal.write(command + '\n');
        commandInput.value = '';
    } else if (!activeTerminal) {
        log('❌ No active terminal available', 'error');
    }
}

// File watcher functionality
let activeWatcher = null;

function initFileWatcher() {
    if (!window.currentCompute) {
        document.getElementById('file-events').innerHTML = '<p style="color: #ff6b6b;">No compute instance active. Go to Compute Manager to create one.</p>';
        return;
    }

    const watchPath = document.getElementById('watch-path');
    const startButton = document.getElementById('start-watch');

    startButton.onclick = () => startWatching(watchPath.value);
}

async function startWatching(path) {
    try {
        if (activeWatcher) {
            log('🛑 Stopping previous watcher...', 'info', 'file-events');
            // Stop previous watcher if exists
        }

        log(`👀 Starting file watcher on ${path}...`, 'info', 'file-events');
        const watcher = window.currentCompute.watchFiles({
            path: path,
            includeContent: true
        });

        activeWatcher = watcher;
        log('✅ File watcher active', 'success', 'file-events');

        watcher.onChanged(async (data) => {
            log(`📄 File change detected:`, 'info', 'file-events');
            log(`   📍 Path: ${data.path}`, 'info', 'file-events');
            log(`   🔄 Type: ${data.type}`, 'info', 'file-events');
            if (data.content) {
                const preview = data.content.slice(0, 100);
                log(`   📝 Content: ${preview}${data.content.length > 100 ? '...' : ''}`, 'info', 'file-events');
            }
        });

    } catch (error) {
        log(`❌ File watcher error: ${error.message}`, 'error', 'file-events');
    }
}

// Initialize terminal when tab is clicked
document.querySelector('[data-tab="terminal"]').addEventListener('click', () => {
    setTimeout(initTerminal, 0);
});

// Initialize file watcher when tab is clicked
document.querySelector('[data-tab="file-watcher"]').addEventListener('click', () => {
    setTimeout(initFileWatcher, 0);
});

// XTerm functionality
let xtermTerminal = null;
let xtermFitAddon = null;
let xtermSession = null;

async function initXTerm() {
    if (!window.currentCompute) {
        document.getElementById('xterm-container').innerHTML = '<p style="color: #ff6b6b; padding: 20px;">No compute instance active. Go to Compute Manager to create one.</p>';
        return;
    }
    
    if (xtermTerminal) return; // Already initialized

    try {
        // Initialize xterm
        xtermTerminal = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4'
            }
        });
        
        xtermFitAddon = new FitAddon.FitAddon();
        xtermTerminal.loadAddon(xtermFitAddon);
        xtermTerminal.loadAddon(new WebLinksAddon.WebLinksAddon());
        
        xtermTerminal.open(document.getElementById('xterm-container'));
        xtermFitAddon.fit();

        // Create terminal session with SDK
        xtermSession = await window.currentCompute.createTerminal();
        
        if (!xtermSession) {
            throw new Error('Failed to create terminal session');
        }

        // Connect xterm to SDK terminal
        xtermSession.onData((data) => {
            xtermTerminal.write(data);
        });

        xtermSession.onExit(({ exitCode, signal }) => {
            xtermTerminal.writeln(`\r\n\x1b[31mTerminal exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ''}\x1b[0m`);
            xtermSession = null;
        });

        // Send xterm input to SDK
        xtermTerminal.onData((data) => {
            if (xtermSession) {
                xtermSession.write(data);
            }
        });

        // Handle terminal resize
        xtermTerminal.onResize(({ cols, rows }) => {
            if (xtermSession) {
                xtermSession.resize(cols, rows);
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            if (xtermFitAddon) xtermFitAddon.fit();
        });

        // Welcome message
        xtermTerminal.writeln('\x1b[32mWelcome to XTerm powered by ComputeSDK! 🚀\x1b[0m');
        
    } catch (error) {
        document.getElementById('xterm-container').innerHTML = `<p style="color: #ff6b6b; padding: 20px;">Error initializing XTerm: ${error.message}</p>`;
        console.error('XTerm initialization error:', error);
    }
}

// Initialize XTerm when tab is clicked
document.querySelector('[data-tab="xterm"]').addEventListener('click', () => {
    setTimeout(initXTerm, 0);
});