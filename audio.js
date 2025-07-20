/**
 * @fileoverview Handles audio playback for sound effects and background music.
 * Manages audio context unlocking and settings persistence.
 */

// --- Audio Element References ---
// Assigned in initializeAudio or assumed to be available globally after DOM load.
let turnSoundElement, captureSoundElement, errorSoundElement,
    hungryWarningSoundElement, undoSoundElement, winSoundElement,
    backgroundMusicElement;

// --- Audio State ---
/** @type {boolean} Flag indicating if sound effects are currently enabled. */
let soundEffectsEnabled = true; // SFX are on by default
/** @type {boolean} Flag to track if the user has interacted with the page (for starting music). */
let hasInteracted = false;

// --- Audio Initialization ---

/**
 * Gets references to all required audio elements.
 * Should be called once the DOM is loaded.
 * @returns {boolean} True if all essential audio elements were found, false otherwise.
 */
function initializeAudioElements() {
    turnSoundElement = document.getElementById('turn-start-sound');
    captureSoundElement = document.getElementById('capture-sound');
    errorSoundElement = document.getElementById('error-sound');
    hungryWarningSoundElement = document.getElementById('hungry-warning-sound'); // Keep if used by TODOs
    undoSoundElement = document.getElementById('undo-sound');
    winSoundElement = document.getElementById('win-sound');
    backgroundMusicElement = document.getElementById('background-music');

    // Validate elements - only background music is arguably critical, others are optional SFX
    if (!backgroundMusicElement) {
        console.warn("Audio Init Warning: Background music element not found.");
        // No return false, game can proceed without music
    }
    if (!turnSoundElement || !captureSoundElement || !errorSoundElement || !undoSoundElement || !winSoundElement) {
        console.warn("Audio Init Warning: One or more sound effect elements not found.");
    }

    // --- Set Default Volumes ---
    // Set win sound volume (example)
    if (winSoundElement) winSoundElement.volume = 0.6; // Set win sound volume to 60%

    // Background music volume is set by loadAudioSettings

    return true; // Assume success even if optional elements are missing
}

/**
 * Loads audio volume and mute settings from localStorage and applies them.
 * Should be called once after audio elements are initialized.
 * Depends on: musicVolumeSlider, musicVolumeDisplay, sfxToggleCheckbox elements,
 *             backgroundMusicElement, soundEffectsEnabled global.
 */
function loadAudioSettings() {
    // --- Load Music Volume ---
    const savedSliderPosition = localStorage.getItem('clestoMusicVolume');
    // Default slider position to 50% (0.5) if nothing is saved
    const initialSliderPosition = (savedSliderPosition !== null) ? parseFloat(savedSliderPosition) : 0.5;

    if (musicVolumeSlider && backgroundMusicElement) {
        // Set the slider's visual position
        musicVolumeSlider.value = initialSliderPosition;

        // Calculate and set the *actual* audio volume (e.g., scaled down to max 10%)
        const actualVolume = initialSliderPosition * 0.1; // Example: slider 1.0 = 10% volume
        backgroundMusicElement.volume = actualVolume;
        backgroundMusicElement.loop = true; // Ensure music loops

        // Update volume display based on the *slider's* position (0-100%)
        if (musicVolumeDisplay) {
            musicVolumeDisplay.textContent = `${Math.round(initialSliderPosition * 100)}%`;
        }
    }

    // --- Load SFX Toggle State ---
    const savedSfxState = localStorage.getItem('clestoSfxEnabled');
    // Default to true if nothing is saved
    soundEffectsEnabled = (savedSfxState !== null) ? (savedSfxState === 'true') : true;
    if (sfxToggleCheckbox) {
        sfxToggleCheckbox.checked = soundEffectsEnabled;
    }
}


// --- Audio Playback ---

/**
 * Plays the specified sound effect element IF sound effects are enabled.
 * Resets playback position and handles potential browser errors.
 * Depends on: soundEffectsEnabled global. Calls logToPanel (debug.js).
 * @param {HTMLAudioElement|null} soundElement - The audio element to play.
 * @param {string} [soundName='Sound'] - A descriptive name for logging purposes.
 */
function playSound(soundElement, soundName = 'Sound') {
    // Check if SFX are enabled
    if (!soundEffectsEnabled) {
        return; // Don't play if SFX are toggled off
    }

    if (soundElement) {
        // Check if ready state is sufficient to play
        if (soundElement.readyState >= 2) { // HAVE_CURRENT_DATA or more
            soundElement.currentTime = 0; // Rewind to start
            soundElement.play().catch(error => {
                 // Log errors, especially NotAllowedError which requires user interaction
                 console.warn(`${soundName} playback failed:`, error.name, error.message);
                 logToPanel('warn', [`${soundName} playback failed: ${error.name}`]);
            });
        } else {
             // Optional: Add an event listener to play when ready, or just log the warning
             console.warn(`${soundName} is not ready to play (readyState: ${soundElement.readyState}). Skipping.`);
             logToPanel('warn', [`${soundName} not ready (readyState ${soundElement.readyState}).`]);
             // Example: Play when ready (can lead to delayed sounds)
             // soundElement.addEventListener('canplaythrough', () => {
             //     soundElement.play().catch(error => console.warn(`${soundName} delayed play failed:`, error));
             // }, { once: true });
        }
    } else {
        console.warn(`Attempted to play non-existent sound element: ${soundName}`);
        logToPanel('warn', [`Attempted to play missing sound: ${soundName}`]);
    }
}

/**
 * Attempts to start the background music playback.
 * Called after first user interaction. Ensures music loops.
 * Depends on: backgroundMusicElement global, hasInteracted global. Calls logToPanel (debug.js).
 */
function startBackgroundMusic() {
    if (!backgroundMusicElement) {
        console.warn("Background music element not found.");
        logToPanel('warn', ["Background music element not found."]);
        return;
    }
    // Ensure music loops
    backgroundMusicElement.loop = true;

    // Check if already playing to avoid interrupting itself
    if (backgroundMusicElement.paused && hasInteracted) { // Only play if paused AND user has interacted
        backgroundMusicElement.play().then(() => {
            logToPanel('log', ["Background music started."]);
        }).catch(error => {
            // Common error: NotAllowedError if interaction wasn't registered correctly
            console.warn("Background music playback failed:", error.name, error.message);
             logToPanel('warn', [`Background music failed: ${error.name}`]);
            // Don't set hasInteracted = false here; let subsequent interactions try again.
        });
    } else if (!hasInteracted) {
         logToPanel('log', ["Background music deferred until interaction."]);
    }
}

/**
 * Plays the turn start sound effect.
 * Depends on: turnSoundElement global, playSound.
 */
function playTurnSound() {
    playSound(turnSoundElement, "Turn Sound");
}


// --- Interaction Handling for Audio ---

/**
 * Should be called on the first user interaction (click, touch, keydown)
 * to enable audio context (required by some browsers) and attempt starting music.
 * Sets the `hasInteracted` flag.
 * Depends on: hasInteracted global, startBackgroundMusic. Calls logToPanel (debug.js).
 */
function handleFirstInteraction() {
    if (!hasInteracted) {
        logToPanel('log', ["First user interaction."]);
        hasInteracted = true; // Set flag so this only runs once

        // Optional: Attempt to "unlock" audio context with a silent sound
        // This is less necessary with modern browsers but can help in some cases
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const buffer = audioContext.createBuffer(1, 1, 22050); // 1 frame, mono, 22.05 kHz
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start(0);
            logToPanel('log', ["Audio context unlocked."]);
            // Close context after unlocking if not needed immediately elsewhere
            if (audioContext.state === 'running') {
                setTimeout(() => audioContext.close(), 500);
            }
        } catch (e) {
            console.warn("Could not create/unlock AudioContext:", e);
            logToPanel('warn', ["Could not unlock AudioContext."]);
        }

        // Attempt to start the background music now that interaction has occurred
        startBackgroundMusic();
    }
}


// --- Export (if using modules) ---
// export { initializeAudio, playSound, handleFirstInteraction, ... };
