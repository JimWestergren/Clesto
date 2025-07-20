/**
 * @fileoverview Debugging utilities, including console overriding
 * and logging messages to a dedicated debug panel in the UI.
 */

// --- Debug State & References ---
// Debug flag is in constants.js (DEBUG_MODE)
// Panel elements references are fetched in ui.js (debugLogContainer, debugLogOutput, clearDebugLogButton)

/**
 * Stores the original console methods before overriding.
 * @type {{log: function, warn: function, error: function}}
 */
const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error
};

// --- Debug Panel Logic ---

/**
 * Formats console arguments into a single string, handling objects and circular references.
 * @param {Array} args - The arguments passed to the console method.
 * @returns {string} A formatted string representation of the arguments.
 */
function formatArgs(args) {
    if (!Array.isArray(args)) return ''; // Handle invalid input

    const seen = new Set(); // Used to detect circular references in objects
    return args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
            try {
                // Stringify objects, handling circular references
                seen.clear(); // Reset for each top-level object
                return JSON.stringify(arg, (key, value) => {
                    if (typeof value === 'object' && value !== null) {
                        if (seen.has(value)) {
                            return '[Circular]'; // Placeholder for circular reference
                        }
                        seen.add(value);
                    }
                    // Handle BigInt specifically for JSON.stringify
                    if (typeof value === 'bigint') {
                        return value.toString() + 'n'; // Append 'n' to denote BigInt
                    }
                    return value;
                }, 2); // Indent with 2 spaces for readability
            } catch (e) {
                // Handle potential errors during stringification
                if (e instanceof TypeError && e.message.includes('circular structure')) {
                    return '[Circular Object]';
                }
                // Handle BigInt TypeError if not caught above
                if (e instanceof TypeError && e.message.includes('Do not know how to serialize a BigInt')) {
                     return String(arg) + 'n (BigInt)'; // Fallback for BigInt
                }
                return '[Unserializable Object]';
            }
        }
        if (typeof arg === 'function') {
            return '[Function]';
        }
        if (typeof arg === 'undefined') {
            return 'undefined';
        }
         if (typeof arg === 'bigint') {
            return arg.toString() + 'n'; // Append 'n' for BigInt
         }
        return String(arg); // Convert other types to string
    }).join(' '); // Join arguments with spaces
}

/**
 * Logs a message to the debug panel DOM element if debugging is enabled.
 * Adds timestamp and level-based styling. Scrolls the panel to the bottom.
 * Depends on: DEBUG_MODE (constants.js), debugLogOutput element.
 * @param {string} level - The log level ('log', 'warn', 'error').
 * @param {Array} args - The original arguments passed to the console method.
 */
function logToPanel(level, args) {
    // Only log if debug mode is ON and the panel output element exists
    if (!DEBUG_MODE || !debugLogOutput) return;

    const message = formatArgs(args);
    const timestamp = new Date().toLocaleTimeString(); // HH:MM:SS format

    const entry = document.createElement('div');
    entry.classList.add('debug-log-entry');

    // Add timestamp span
    const timeSpan = document.createElement('span');
    timeSpan.classList.add('debug-log-timestamp');
    timeSpan.textContent = `[${timestamp}] `; // Add space after timestamp
    entry.appendChild(timeSpan);

    // Add message content span with level-specific class
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    if (level === 'warn') {
        messageSpan.classList.add('debug-log-warn');
    } else if (level === 'error') {
        messageSpan.classList.add('debug-log-error');
    } // 'log' level has no specific class, uses default style
    entry.appendChild(messageSpan);

    // Append to panel and scroll to bottom
    debugLogOutput.appendChild(entry);
    // Scroll smoothly or instantly
    debugLogOutput.scrollTop = debugLogOutput.scrollHeight;
    // debugLogOutput.scrollTo({ top: debugLogOutput.scrollHeight, behavior: 'smooth' }); // Optional smooth scroll
}

// --- Console Overriding ---

/**
 * Initializes the console overriding mechanism.
 * Replaces standard console methods (log, warn, error) to potentially suppress output
 * and forward messages to the debug panel based on the DEBUG_MODE flag.
 * Depends on: DEBUG_MODE (constants.js), originalConsole, logToPanel.
 */
function initializeConsoleOverride() {
    // Override console.log
    console.log = function(...args) {
        // Always log to the panel (it checks DEBUG_MODE internally)
        logToPanel('log', args);
        // Only call the original console method if debug mode is enabled
        if (DEBUG_MODE) {
            originalConsole.log.apply(console, args);
        }
    };

    // Override console.warn
    console.warn = function(...args) {
        logToPanel('warn', args);
        if (DEBUG_MODE) {
            originalConsole.warn.apply(console, args);
        }
    };

    // Override console.error
    console.error = function(...args) {
        logToPanel('error', args);
        if (DEBUG_MODE) {
            originalConsole.error.apply(console, args);
        }
    };

    console.log("Console methods overridden for debug panel integration.");
}

// --- Debug Panel Visibility ---

/**
 * Shows or hides the debug panel container based on the DEBUG_MODE flag.
 * Should be called after the DOM is ready and elements are fetched.
 * Depends on: DEBUG_MODE (constants.js), debugLogContainer element.
 */
function setupDebugPanelVisibility() {
    if (!debugLogContainer) {
         console.warn("Debug panel container not found. Cannot manage visibility."); // Use original console here
         return;
    }
    if (DEBUG_MODE) {
        debugLogContainer.classList.remove('debug-hidden');
    } else {
        debugLogContainer.classList.add('debug-hidden');
    }
}

// --- Export (if using modules) ---
// export { initializeConsoleOverride, setupDebugPanelVisibility, logToPanel };