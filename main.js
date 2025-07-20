/**
 * @fileoverview Main entry point for the Clesto game application.
 * Initializes modules, sets up the game, and coordinates UI interactions with game logic.
 */

// --- Global Variables (Consider reducing scope later if possible) ---
// These might be needed across modules or are central controllers
/** @type {number|null} Timeout ID for AI move delay. */
let aiMoveTimeoutId = null;
/** @type {boolean} Flag indicating if the game is in Player vs Player mode. */
let isPlayerVsPlayerMode = false;
/** @type {number} Global clock time for Orange player (in seconds). */
let orangeTime = INITIAL_TIME_SECONDS; // Needs INITIAL_TIME_SECONDS from constants.js
/** @type {number} Global clock time for Yellow player (in seconds). */
let yellowTime = INITIAL_TIME_SECONDS; // Needs INITIAL_TIME_SECONDS from constants.js
/** @type {number|null} Interval ID for Orange's clock timer. */
let orangeTimerId = null;
/** @type {number|null} Interval ID for Yellow's clock timer. */
let yellowTimerId = null;


// --- Core Game Initialization ---

/**
 * Sets up the initial game state, creates the board display, places pieces,
 * initializes Zobrist hashing, computes the initial hash (including hungry state),
 * clears the Transposition Table, initializes clocks, and updates the UI.
 * Accepts an optional custom starting state, either as a board object or pre-parsed bitboards.
 * Depends on: transpositionTable, initializeBitboardCoordMapping, initializeTerrainBitboards,
 *             initializeJumpMasks, initializePositionalMasks, initZobrist, initializeClocks,
 *             createInitialGameState, setupBitboardsFromObject, computeZobristHashBB,
 *             createBoard, placePiecesBB, logBoardStateStringUI, updateUI, clearHighlights,
 *             enablePlayerInteraction, updateUndoButtonState, startClock, playTurnSound,
 *             PLAYERS, INITIAL_SETUP, BB_IDX (constants.js). Needs pvp-toggle element.
 * Modifies: gameState, gameHistory, playerLastMoves (globals in gameState.js),
 *           orangeTime, yellowTime, aiMoveTimeoutId (globals in main.js), isPlayerVsPlayerMode.
 *
 * @param {object|bigint[]|null} [startState=null] - Optional starting state.
 *        - If object: A board object like INITIAL_SETUP ({ coords: pieceData }).
 *        - If array: A pre-parsed bitboard array (length BB_IDX.COUNT).
 *        - If null: Uses INITIAL_SETUP.
 * @param {boolean} [isLoadingFromState=false] - Flag indicating loading, affects PvP toggle reset.
 */
function initializeGame(startState = null, isLoadingFromState = false) {
    console.log("Initializing game..." + (startState ? " with custom state." : ""));

    // --- Clear AI State & Timers ---
    if (aiMoveTimeoutId) { clearTimeout(aiMoveTimeoutId); aiMoveTimeoutId = null; }
    transpositionTable.clear();

    // --- Ensure Core Mappings/Keys are Ready ---
    initializeBitboardCoordMapping();
    initializeTerrainBitboards();
    initializePositionalMasks();
    initializeJumpMasks();
    initZobrist();

    // --- Initialize Clocks ---
    initializeClocks();

    // --- Setup Bitboards ---
    let initialBitboards = null;
    if (startState === null) {
        // Use default setup
        const startingBoardObj = JSON.parse(JSON.stringify(INITIAL_SETUP));
        initialBitboards = setupBitboardsFromObject(startingBoardObj);
    } else if (Array.isArray(startState) && startState.length === BB_IDX.COUNT) {
        // Received pre-parsed bitboards - use them directly (copy for safety)
        console.log("Initializing from provided bitboard array.");
        initialBitboards = [...startState];
        // Validate the OCCUPIED board? Optional sanity check.
        const calculatedOccupied = initialBitboards[BB_IDX.ORANGE_PIECES] | initialBitboards[BB_IDX.YELLOW_PIECES];
        if (initialBitboards[BB_IDX.OCCUPIED] !== calculatedOccupied) {
            console.warn("Provided bitboards had inconsistent OCCUPIED board. Recalculating.");
            initialBitboards[BB_IDX.OCCUPIED] = calculatedOccupied;
        }
    } else if (typeof startState === 'object' && !Array.isArray(startState)) {
        // Received a board object - parse it
        console.log("Initializing from provided board object.");
        const startingBoardObj = JSON.parse(JSON.stringify(startState)); // Clone object
        initialBitboards = setupBitboardsFromObject(startingBoardObj);
    } else {
        console.error("CRITICAL ERROR: Invalid startState provided to initializeGame.", startState);
        updateStatus("Error initializing board state.");
        return;
    }

    if (!initialBitboards) {
        console.error("CRITICAL ERROR: Failed to setup bitboards. Aborting initialization.");
        updateStatus("Error initializing board state.");
        return;
    }

    // --- Initialize Core Game State ---
    gameState = createInitialGameState(); // Creates structure including hungryBB
    gameState.bitboards = initialBitboards;
    gameHistory = [];

    // Reset PvP toggle state only if NOT loading from external state string/file
    if (!isLoadingFromState && pvpToggleButton) {
        isPlayerVsPlayerMode = false;
        pvpToggleButton.checked = false;
    } else if (isLoadingFromState && pvpToggleButton) {
        // Keep current PvP mode when loading state (assume it doesn't change)
        pvpToggleButton.checked = isPlayerVsPlayerMode;
    }

    // --- UI Setup (Board Structure) ---
    createBoard(); // Create the cell grid
    placePiecesBB(); // Draw pieces based on initial bitboards

    // --- Compute Initial Zobrist Hash ---
    // Pass the initial (empty) hungry state to the hash function
    gameState.zobristHash = computeZobristHashBB(
        gameState.bitboards,
        gameState.currentPlayer,
        gameState.hungryBB // <-- Pass the hungryBB state here
    );
    if (gameState.zobristHash !== 0n || Object.keys(zobristKeys).length > 0) { // Only add if hash/keys are valid
        gameState.boardStateHistory[gameState.zobristHash.toString()] = 1;
    } else {
        console.error("Failed to compute initial Zobrist hash. Repetition detection disabled.");
    }


    // --- Initial UI Render ---
    rebuildMoveLog(); // Rebuild log from empty history
    renderGame(gameState); // Central function to draw pieces, set turn, clocks, etc.
    selectedPieceCoords = null; // Ensure no piece is selected initially
    focusedCoords = null; // Ensure no cell/piece has focus initially

    // --- Enable Interaction & Start Clock ---
    // Assume starting player is always Orange initially
    gameState.currentPlayer = PLAYERS.ORANGE;
    if (!gameState.gameOver) { // Check if loaded state is already game over
        enablePlayerInteraction();
        startClock(PLAYERS.ORANGE);
    } else {
        // If loaded state is game over, renderGame handles the display, just disable interaction
        disablePlayerInteraction();
    }

    console.log("Game Initialized.", isLoadingFromState ? "(Loaded State)" : "(New Game)", "Orange starts.");
}


// --- Core Game Loop Wrappers ---

/**
 * Wrapper function called by UI event handlers (drop, click) to perform a move.
 * 1. Calls `performMoveBB` from gameLogic to update the state.
 * 2. If successful, saves state for undo, updates UI elements, hides tooltips, and handles AI turn triggering.
 * Depends on: performMoveBB (gameLogic.js), saveGameState (gameState.js),
 *             placePiecesBB, updateTrapIndicatorVisual, updateHungryVisual, deselectPiece, hideSharedTooltip, // <-- Added hideSharedTooltip
 *             logBoardStateStringUI, rebuildMoveLog (or addLogEntryToDOM), highlightLastMoves,
 *             updateStatus, updateUI, switchClocks, disablePlayerInteraction, enablePlayerInteraction,
 *             playTurnSound, playSound, playWinSound, triggerAIMove, aiMoveTimeoutId,
 *             isPlayerVsPlayerMode, PLAYERS (constants.js), coordToBitIndex, getBit, allTrapsBB, BB_EMPTY,
 *             hungryWarningSoundElement, captureSoundElement, errorSoundElement, winSoundElement (audio.js). // <-- Added audio element dependencies
 *
 * @param {string} fromCoords - The starting coordinates of the move.
 * @param {string} toCoords - The ending coordinates of the move.
 */
function performMove(fromCoords, toCoords) {
    saveGameState();
    const moveResult = performMoveBB(fromCoords, toCoords);

    if (moveResult && moveResult.success) {
        deselectPiece(); // Deselect first to clear related highlights

        // --- UI Updates for Piece Movement & Capture ---
        if (moveResult.capturedPieceTypeIndex !== null) {
            const capturedElement = document.getElementById(getPieceElementId(toCoords));
            if (capturedElement) {
                capturedElement.classList.add('captured');
                setTimeout(() => capturedElement.remove(), 400);
                playSound(captureSoundElement, "Capture Sound");
            }
        }

        const pieceElement = document.getElementById(getPieceElementId(fromCoords));
        let movedPieceElementRef = null;
        if (pieceElement) {
            pieceElement.id = getPieceElementId(toCoords);
            positionElementOnBoard(pieceElement, toCoords);
            movedPieceElementRef = pieceElement;
            const movedPieceIndex = coordToBitIndex(toCoords);
            const isOnTrap = getBit(allTrapsBB, movedPieceIndex) !== 0n;
            updateTrapIndicatorVisual(toCoords, isOnTrap, movedPieceElementRef);
        } else if (!moveResult.starvedPiecesCoords?.includes(fromCoords)) {
            console.error(`!!! Piece element not found for move ${fromCoords} -> ${toCoords} and it wasn't starved! Re-placing all pieces.`);
            placePiecesBB(); // Attempt recovery by redrawing all pieces
        }

        moveResult.starvedPiecesCoords?.forEach(coord => {
            const starvedElement = document.getElementById(getPieceElementId(coord));
            if (starvedElement) {
                console.log(`UI: Removing starved piece at ${coord}`);
                starvedElement.classList.add('captured');
                setTimeout(() => starvedElement.remove(), 400);
            }
        });

        // --- Update Hunger Visuals ---
        // Clear hunger from the moved piece's new location (it can't be hungry right after moving)
        if (movedPieceElementRef && !moveResult.starvedPiecesCoords?.includes(fromCoords)) {
             updateHungryVisual(toCoords, false, movedPieceElementRef);
        }
        // Update visuals for all pieces of the *next* player
        const nextPlayerHungryBB = gameState.hungryBB?.[gameState.currentPlayer] ?? BB_EMPTY;
        const nextPlayer = gameState.currentPlayer;
        const pieceTypeStart = nextPlayer === PLAYERS.ORANGE ? BB_IDX.PIECE_START : Y_RAT_IDX;
        const pieceTypeEnd = nextPlayer === PLAYERS.ORANGE ? O_ELEPHANT_IDX : BB_IDX.PIECE_END;
        let anyHungry = false; // Track if any opponent piece became hungry
        for (let pieceTypeIndex = pieceTypeStart; pieceTypeIndex <= pieceTypeEnd; pieceTypeIndex++) {
             let pieceBoard = gameState.bitboards[pieceTypeIndex];
             while(pieceBoard !== BB_EMPTY) {
                 const lsb = lsbIndex(pieceBoard);
                 if(lsb === -1) break;
                 const currentCoords = bitIndexToCoord(lsb);
                 if(currentCoords) {
                     const isHungry = getBit(nextPlayerHungryBB, lsb) !== 0n;
                     updateHungryVisual(currentCoords, isHungry); // Update visual based on gameState
                     if (isHungry) anyHungry = true; // Set flag if any piece is hungry
                 }
                 pieceBoard = clearBit(pieceBoard, lsb);
             }
        }
        // Play hungry sound ONCE if any opponent piece became hungry
        if (anyHungry) {
            playSound(hungryWarningSoundElement, "Hungry Warning");
        }
        // -----------------------------

        // --- Add Move to Log ---
        if (moveResult.notation && typeof moveResult.turnNumber === 'number') {
            const turnData = gameState.moveHistory.get(moveResult.turnNumber);
            if (turnData) {
                // Remove existing entry if updating, then add new one
                let existingLogDiv = moveLogElement.querySelector(`div.log-entry[data-turn="${moveResult.turnNumber}"]`);
                if (existingLogDiv) existingLogDiv.remove();
                addLogEntryToDOM(moveResult.turnNumber, turnData.orange, turnData.yellow);
            }
        }

        // --- Centralized UI Render ---
        renderGame(gameState); // Update board, clocks, turn indicator, etc.

        // --- Ensure Tooltip is Hidden After Move ---
        hideSharedTooltip(); // <<<====== ADDED THIS CALL

        // --- Handle Clocks & Turn Sounds ---
        if (!moveResult.isGameOver) {
            switchClocks(moveResult.playerWhoMoved); // Switch clocks AFTER rendering the state before the switch
            playTurnSound();
        } else {
            pauseAllClocks();
            // renderGame already set the game over status message
            playSound(winSoundElement, "Win Sound");
            disablePlayerInteraction(); // Ensure interaction is off
        }

        // --- Trigger AI ---
        if (!isPlayerVsPlayerMode && gameState.currentPlayer === PLAYERS.YELLOW && !gameState.gameOver) {
            disablePlayerInteraction();
            updateUndoButtonState();
            if (aiMoveTimeoutId) clearTimeout(aiMoveTimeoutId);
            aiMoveTimeoutId = setTimeout(triggerAIMove, 500);
        } else if (!gameState.gameOver) {
            enablePlayerInteraction();
        }

    } else if (moveResult && !moveResult.success) {
        // --- Invalid Move Handling ---
        updateStatus(`Invalid move: ${moveResult.reason || 'Unknown reason'}`);
        flashCell(toCoords, 'red');
        playSound(errorSoundElement, "Error Sound");
        if (gameHistory.length > 0) { gameHistory.pop(); } // Remove the saved state for the failed move
        updateUndoButtonState();
        const el = document.getElementById(getPieceElementId(fromCoords));
        if (el && document.body.contains(el)) {
            positionElementOnBoard(el, fromCoords); // Ensure piece is visually back if drag was attempted
            el.classList.remove('selected');
        }
        deselectPiece(); // Deselect after invalid attempt
        hideSharedTooltip(); // Ensure tooltip is hidden after invalid attempt too

    } else {
        // --- Critical Error Handling ---
        updateStatus("Critical error performing move.");
        playSound(errorSoundElement, "Error Sound");
        if (gameHistory.length > 0) { gameHistory.pop(); }
        // Attempt to render the current (potentially corrupted) state
        renderGame(gameState);
        deselectPiece();
        hideSharedTooltip(); // Ensure tooltip is hidden after error
    }
}


/**
 * Handles the Undo button action. Reverts the game state using saved history.
 * Manages game mode (PvP/PvE) considerations and AI state.
 * Depends on: isPlayerVsPlayerMode, gameState, gameHistory (gameState.js),
 *             transpositionTable (gameState.js), aiMoveTimeoutId,
 *             loadGameState (gameState.js), placePiecesBB, rebuildMoveLog, highlightLastMoves,
 *             updateUI, logBoardStateStringUI, // <-- Updated function name
 *             updateStatus, enablePlayerInteraction, disablePlayerInteraction,
 *             resumeClockForCurrentPlayer, pauseAllClocks, updateUndoButtonState, playSound, playTurnSound,
 *             PLAYERS (constants.js).
 */
function undoMove() {
    // Prevent undo while AI is thinking
    if (!isPlayerVsPlayerMode && gameState.currentPlayer === PLAYERS.YELLOW && boardGridWrapper?.style.pointerEvents === 'none') {
        updateStatus("Cannot undo while AI is thinking.");
        playSound(errorSoundElement, "Error Sound");
        return;
    }

    let statesToPop = 1;
     if (!isPlayerVsPlayerMode && gameHistory.length >= 2) {
        statesToPop = 2;
     } else if (!isPlayerVsPlayerMode && gameHistory.length === 1 && gameState.turnNumber > 1) {
         statesToPop = 1;
     }

    if (gameHistory.length < statesToPop) {
        updateStatus("Nothing to undo.");
        playSound(errorSoundElement, "Error Sound");
        return;
    }

    // --- Clear AI State & Timers ---
    transpositionTable.clear();
    if (aiMoveTimeoutId) { clearTimeout(aiMoveTimeoutId); aiMoveTimeoutId = null; }
    pauseAllClocks();

    playSound(undoSoundElement, "Undo Sound");

    // --- Pop and Load State ---
    let stateToRestore = null;
    for (let i = 0; i < statesToPop; i++) {
        stateToRestore = gameHistory.pop();
    }

    if (!stateToRestore) {
        console.error("Undo Error: Could not retrieve a state to restore.");
        initializeGame();
        updateStatus("Undo error or history empty. Game reset.");
        updateUndoButtonState();
        return;
    }

    // --- Load the retrieved state ---
    const loadSuccess = loadGameState(stateToRestore);
    if (!loadSuccess) {
        console.error("Undo Error: Failed to load the restored state object.");
        initializeGame();
        updateStatus("Undo error during state loading. Game reset.");
         updateUndoButtonState();
        return;
    }

    // --- Update UI to reflect loaded state ---
    placePiecesBB(); // Redraw pieces for the restored state
    rebuildMoveLog(); // Rebuild the visual log from the restored history
    renderGame(gameState); // Central function updates pieces, clocks, turn, etc.
    // Status message is set by renderGame

    // --- Handle Post-Undo Interaction & Clocks ---
    if (!gameState.gameOver) {
        enablePlayerInteraction(); // Re-enable interaction if game is not over
        resumeClockForCurrentPlayer();
        playTurnSound();
    } else {
        disablePlayerInteraction();
    }
    // Deselect piece after undo to avoid confusion
    deselectPiece();
}


// --- Clock Management ---

/**
 * Updates the clock display for a specific player in the DOM.
 * Adds/removes a 'time-out' class if the time is zero or less.
 * Depends on: formatTime (utils.js). Needs clock time elements.
 * @param {string} player - The player (PLAYERS.ORANGE or PLAYERS.YELLOW).
 * @param {number} timeSeconds - The time in seconds to display.
 */
function updateClockDisplay(player, timeSeconds) {
    const formattedTime = formatTime(timeSeconds);
    let clockElement = null;
    let clockContainer = null;

    if (player === PLAYERS.ORANGE) {
        clockElement = orangeClockTimeElement;
        clockContainer = orangeClockContainer;
    } else if (player === PLAYERS.YELLOW) {
        clockElement = yellowClockTimeElement;
        clockContainer = yellowClockContainer;
    }

    if (clockElement) {
        clockElement.textContent = formattedTime; // Update time text
        // Add or remove the 'time-out' class based on the time value
        if (timeSeconds <= 0) {
            clockElement.classList.add('time-out');
        } else {
            clockElement.classList.remove('time-out');
        }
    }
     if(clockContainer){
        // Optional: update container style based on time out
        if (timeSeconds <= 0) {
             clockContainer.classList.add('container-time-out'); // Example class
        } else {
             clockContainer.classList.remove('container-time-out');
        }
     }
}

/**
 * Stops the interval timer for a specific player's clock.
 * Removes the 'clock-active' class from the container.
 * Depends on: orangeTimerId, yellowTimerId globals. Needs clock container elements.
 * @param {string} player - The player (PLAYERS.ORANGE or PLAYERS.YELLOW).
 */
function stopClock(player) {
    if (player === PLAYERS.ORANGE) {
        if (orangeTimerId !== null) {
            clearInterval(orangeTimerId);
            orangeTimerId = null;
        }
        if (orangeClockContainer) orangeClockContainer.classList.remove('clock-active');
    } else if (player === PLAYERS.YELLOW) {
        if (yellowTimerId !== null) {
            clearInterval(yellowTimerId);
            yellowTimerId = null;
        }
        if (yellowClockContainer) yellowClockContainer.classList.remove('clock-active');
    }
}

/**
 * Starts the interval timer for a specific player's clock.
 * Decrements time, updates display, handles time out (stops clock, logs).
 * Depends on: gameState, orangeTime, yellowTime, orangeTimerId, yellowTimerId globals,
 *             updateClockDisplay, stopClock. Needs clock container elements.
 * @param {string} player - The player (PLAYERS.ORANGE or PLAYERS.YELLOW) whose clock to start.
 */
function startClock(player) {
    if (gameState.gameOver) return; // Don't start if game is over

    // Stop the other player's clock first
    const otherPlayer = player === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    stopClock(otherPlayer);

    // Clear existing timer for the target player before starting a new one
    stopClock(player);

    const tick = () => {
        if (player === PLAYERS.ORANGE) {
            orangeTime--;
            updateClockDisplay(PLAYERS.ORANGE, orangeTime);
            if (orangeTime <= 0) {
                stopClock(PLAYERS.ORANGE); // Stop the clock at 00:00
                // TODO: Implement game loss on time out if desired
                 // gameState.gameOver = true;
                 // gameState.winner = PLAYERS.YELLOW;
                 // updateStatus("Orange time ran out. Yellow wins!");
                 // updateUI();
                 // disablePlayerInteraction();
            }
        } else if (player === PLAYERS.YELLOW) {
            yellowTime--;
            updateClockDisplay(PLAYERS.YELLOW, yellowTime);
            if (yellowTime <= 0) {
                stopClock(PLAYERS.YELLOW); // Stop the clock at 00:00
                // TODO: Implement game loss on time out if desired
                 // gameState.gameOver = true;
                 // gameState.winner = PLAYERS.ORANGE;
                 // updateStatus("Yellow time ran out. Orange wins!");
                 // updateUI();
                 // disablePlayerInteraction();
            }
        }
         // Check if game ended due to time out during the tick
         if (gameState.gameOver) {
             pauseAllClocks(); // Ensure both are stopped if game ended
             return;
         }
    };

    // Initial immediate display update and tick to avoid 1-second delay
    updateClockDisplay(player, player === PLAYERS.ORANGE ? orangeTime : yellowTime);
    if (player === PLAYERS.ORANGE && orangeClockContainer) orangeClockContainer.classList.add('clock-active');
    if (player === PLAYERS.YELLOW && yellowClockContainer) yellowClockContainer.classList.add('clock-active');
    // Only start interval if time > 0
    if ((player === PLAYERS.ORANGE && orangeTime > 0) || (player === PLAYERS.YELLOW && yellowTime > 0)) {
        tick(); // Manually call first tick immediately *if* time > 0
        // Then set the interval
        if (player === PLAYERS.ORANGE) {
            orangeTimerId = setInterval(tick, 1000);
        } else if (player === PLAYERS.YELLOW) {
            yellowTimerId = setInterval(tick, 1000);
        }
    }
}

/**
 * Stops both players' clocks. Used for game end or pausing.
 * Depends on: stopClock.
 */
function pauseAllClocks() {
    stopClock(PLAYERS.ORANGE);
    stopClock(PLAYERS.YELLOW);
}

/**
 * Resets clock times to initial values and updates displays. Stops timers.
 * Depends on: pauseAllClocks, INITIAL_TIME_SECONDS (constants.js), updateClockDisplay.
 * Modifies: orangeTime, yellowTime globals. Needs clock container elements.
 */
function initializeClocks() {
    pauseAllClocks(); // Ensure any running timers are stopped
    orangeTime = INITIAL_TIME_SECONDS;
    yellowTime = INITIAL_TIME_SECONDS;
    updateClockDisplay(PLAYERS.ORANGE, orangeTime);
    updateClockDisplay(PLAYERS.YELLOW, yellowTime);
    // Ensure active classes are removed
    if (orangeClockContainer) orangeClockContainer.classList.remove('clock-active');
    if (yellowClockContainer) yellowClockContainer.classList.remove('clock-active');
}

/**
 * Stops the clock of the player who just moved, adds increment, updates their display,
 * and starts the opponent's clock. Call this *before* switching gameState.currentPlayer.
 * Depends on: gameState, stopClock, INCREMENT_SECONDS (constants.js), updateClockDisplay, startClock.
 * Modifies: orangeTime, yellowTime globals.
 * @param {string} playerWhoMoved - The player who just completed their move.
 */
function switchClocks(playerWhoMoved) {
    if (gameState.gameOver) return; // Don't switch if game ended

    // 1. Stop the clock for the player who moved
    stopClock(playerWhoMoved);

    // 2. Add increment (only if time hasn't run out)
    if (playerWhoMoved === PLAYERS.ORANGE && orangeTime > 0) {
        orangeTime += INCREMENT_SECONDS;
    } else if (playerWhoMoved === PLAYERS.YELLOW && yellowTime > 0) {
        yellowTime += INCREMENT_SECONDS;
    }
    // Update display immediately after adding increment
    updateClockDisplay(playerWhoMoved, playerWhoMoved === PLAYERS.ORANGE ? orangeTime : yellowTime);

    // 3. Start the opponent's clock
    const opponent = playerWhoMoved === PLAYERS.ORANGE ? PLAYERS.YELLOW : PLAYERS.ORANGE;
    startClock(opponent);
}

/**
 * Resumes the clock for the currently active player based on gameState.
 * Used after loading state (undo) or switching game modes.
 * Depends on: gameState, pauseAllClocks, startClock.
 */
function resumeClockForCurrentPlayer() {
    if (gameState.gameOver) {
        pauseAllClocks();
        return;
    }
    startClock(gameState.currentPlayer); // startClock stops the other clock first
}

// --- Window Load ---

/**
 * Main entry point. Waits for the DOM and resources to load,
 * then initializes all parts of the application.
 */
window.addEventListener('load', () => {
    console.log("Window loaded. Initializing Clesto...");

    // 1. Initialize Core Mappings & Keys (Must be first)
    initializeBitboardCoordMapping(); // From bitboardUtils.js
    initZobrist(); // From gameState.js

    // 2. Initialize Terrain/Positional Masks
    initializeTerrainBitboards(); // From bitboardUtils.js
    initializePositionalMasks(); // From bitboardUtils.js
    initializeJumpMasks(); // From bitboardUtils.js

    // 3. Initialize UI Elements
    if (!initializeDOMElements()) { // From ui.js
        // Handle critical error if essential elements are missing
        document.body.innerHTML = '<h1 style="color:red;">Error: Could not initialize UI. Essential elements missing.</h1>';
        return;
    }

    // 4. Initialize Audio System
    initializeAudioElements(); // From audio.js
    loadAudioSettings(); // From audio.js

    // 5. Initialize Debug System (includes console override)
    initializeConsoleOverride(); // From debug.js
    setupDebugPanelVisibility(); // From debug.js

    // 6. Initialize Game State & Board
    initializeGame(); // From main.js (this file)

    // 7. Setup Event Listeners (after game and UI are ready)
    setupEventListeners(); // From ui.js

    console.log("Clesto initialization complete. Game ready.");

    // Background music attempts to start after first user interaction via handleFirstInteraction() in audio.js
});

// --- Export (if using modules) ---
// export { initializeGame, performMove, undoMove, ... };
