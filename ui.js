/**
 * @fileoverview Handles UI rendering, event handling, DOM manipulation,
 * and visual feedback for the Clesto game.
 */

// --- DOM Element References ---
// Assigned in initializeUI or assumed to be available globally after DOM load.
let boardElement, boardGridWrapper, turnIndicator, statusMessage, resetButton,
    undoButton, moveLogElement, copyLogButton, boardStateLogElement,
    copyStateButton, pieceAssetContainer, debugLogContainer, debugLogOutput,
    clearDebugLogButton, orangeClockContainer, yellowClockContainer,
    orangeClockTimeElement, yellowClockTimeElement, sharedMoveTooltip,
    loadStateButton, boardStateInput, loadStatusMessage, rulesButton,
    rulesContent, pvpToggleButton, musicVolumeSlider, musicVolumeDisplay,
    sfxToggleCheckbox;

// --- UI State Variables ---
/** @type {HTMLElement|null} Reference to the DOM element being dragged. */
let draggedPieceElement = null;
/** @type {string|null} Algebraic coordinates of the piece being dragged/touched from. */
let sourceCoords = null;
/** @type {string|null} Algebraic coordinates of the piece currently selected via click/tap. */
let selectedPieceCoords = null;
/** @type {string|null} Algebraic coordinates of the currently focused cell/piece (for keyboard nav). */
let focusedCoords = null;
/** @type {boolean} Flag to track if a drag operation is in progress. */
let isDragging = false;
/** @type {boolean} Flag indicating if the "Load State" input field has focus. */
let isLoadStateInputFocused = false;
/** @type {number|null} Timeout ID for the shared tooltip hide delay. */
let tooltipHideTimeout = null;
/** @type {number|null} Timeout ID for the piece info tooltip show delay. */
let pieceTooltipTimeoutId = null;
/** @type {{x: number, y: number}} Stores initial touch coordinates for drag calculation. */
let touchStartCoords = { x: 0, y: 0 }; // Renamed from touchStartX/Y


// --- DOM Element ID Generation ---

/**
 * Generates the DOM ID for a piece element based on its coordinates.
 * @param {string} coords - The coordinates (e.g., 'a1').
 * @returns {string} The DOM ID string (e.g., 'piece-a1').
 */
function getPieceElementId(coords) {
    return `piece-${coords}`;
}

/**
 * Generates the DOM ID for a cell element based on coordinates.
 * @param {string} coords - The coordinates (e.g., 'a1').
 * @returns {string} The DOM ID string (e.g., 'cell-a1').
 */
function getCellElementId(coords) {
    return `cell-${coords}`;
}

/**
 * Utility function to extract coordinates from a DOM element (cell or piece).
 * @param {HTMLElement|EventTarget|null} element - The DOM element or event target.
 * @returns {string|null} The algebraic coordinates or null if not found.
 */
function getCoordsFromElement(element) {
    if (!(element instanceof Element)) return null; // Ensure it's an element

    // Check if the element itself is a piece or cell
    if (element.matches('.piece, .cell') && element.dataset.coords) {
        return element.dataset.coords;
    }
    // Check if the element is inside a piece or cell
    const closestMatch = element.closest('.piece, .cell');
    if (closestMatch && closestMatch.dataset.coords) {
        return closestMatch.dataset.coords;
    }
    return null; // Coordinates not found
}

// --- Board Creation and Rendering ---

/**
 * Creates the grid of cell elements and appends them to the board wrapper.
 * Assigns IDs, data attributes, classes for terrain, and event listeners.
 * Depends on: ROWS, COLS, WATER_SQUARES, TRAPS, DENS (constants.js),
 *             getCoords (utils.js), getCellElementId, handleDragOver, handleDragEnter,
 *             handleDragLeave, handleDrop, handleCellClick. Needs boardGridWrapper element.
 */
function createBoard() {
    if (!boardGridWrapper) {
        console.error("createBoard Error: boardGridWrapper element not found.");
        return;
    }
    boardGridWrapper.innerHTML = ''; // Clear previous board
    boardGridWrapper.setAttribute('role', 'grid'); // ARIA role for the grid container

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = document.createElement('div');
            const coords = getCoords(r, c);
            if (!coords) continue; // Should not happen

            cell.id = getCellElementId(coords);
            cell.classList.add('cell');
            cell.dataset.coords = coords;
            cell.dataset.row = r;
            cell.dataset.col = c;

            // ARIA roles and properties for accessibility
            cell.setAttribute('role', 'gridcell');
            cell.setAttribute('tabindex', '-1'); // Initially not focusable by default Tab key
            // aria-label can be added dynamically if needed, e.g., when highlighting moves

            // Add terrain classes
            if (WATER_SQUARES.has(coords)) cell.classList.add('water');
            if (TRAPS.orange.has(coords)) cell.classList.add('trap-yellow'); // Trap affecting yellow
            if (TRAPS.yellow.has(coords)) cell.classList.add('trap-orange'); // Trap affecting orange
            if (DENS.orange === coords) cell.classList.add('den-orange');
            if (DENS.yellow === coords) cell.classList.add('den-yellow');

            boardGridWrapper.appendChild(cell);

            // Add event listeners for drag/drop and click
            cell.addEventListener('dragover', handleDragOver);
            cell.addEventListener('dragenter', handleDragEnter);
            cell.addEventListener('dragleave', handleDragLeave);
            cell.addEventListener('drop', handleDrop); // handleDrop calls handleFirstInteraction
            cell.addEventListener('click', handleCellClick); // handleCellClick calls handleFirstInteraction

            // Update focusedCoords state when a cell receives focus
            cell.addEventListener('focus', () => {
                focusedCoords = coords;
            });
            // Optional: Add blur listener if needed
            // cell.addEventListener('blur', () => {
            //     if (focusedCoords === coords) focusedCoords = null;
            // });
        }
    }
}

/**
 * Creates a DOM element for a game piece.
 * Clones asset from pieceAssetContainer if available.
 * Adds necessary classes, data attributes, ARIA roles, and event listeners.
 * Includes the trap rank indicator span.
 * Depends on: getPieceElementId, RANK_TO_NAME, PLAYERS (constants.js),
 *             handleDragStart, handleDragEnd, handleTouchStart, handleTouchMove, handleTouchEnd,
 *             handlePieceClick, handlePieceMouseOver, handlePieceMouseOut, handleDrop, handleDragOver,
 *             handleDragEnterPiece, handleDragLeavePiece. Needs pieceAssetContainer element.
 *
 * @param {{player: string, rank: number}} pieceData - The piece data { player, rank }. Coords not needed here.
 * @param {string} coords - The algebraic coordinates where the piece will be initially placed.
 * @returns {HTMLElement} The created piece div element.
 */
function createPieceElement(pieceData, coords) {
    const pieceElement = document.createElement('div');
    pieceElement.id = getPieceElementId(coords); // ID based on initial coords
    pieceElement.classList.add('piece');
    // Store rank and player in dataset for easy access by event handlers/tooltips
    pieceElement.dataset.rank = pieceData.rank;
    pieceElement.dataset.player = pieceData.player;
    pieceElement.dataset.coords = coords; // Store initial coords

    // Accessibility attributes
    pieceElement.setAttribute('role', 'button'); // Pieces are interactive elements
    pieceElement.setAttribute('aria-label', `${pieceData.player} ${RANK_TO_NAME[pieceData.rank]} at ${coords}`);
    pieceElement.setAttribute('tabindex', '-1'); // Initially not focusable, updated by updatePieceAccessibility

    // Attempt to clone image asset
    const pieceKey = `${pieceData.player === PLAYERS.ORANGE ? 'O' : 'Y'}_${pieceData.rank}`;
    const asset = pieceAssetContainer?.querySelector(`[data-piece="${pieceKey}"]`);

    if (asset && asset.tagName === 'IMG') {
        const img = asset.cloneNode(true);
        img.setAttribute('alt', ''); // Decorative image, label is on parent div
        img.setAttribute('aria-hidden', 'true');
        img.draggable = false; // Prevent dragging the image itself
        pieceElement.appendChild(img);
    } else {
        if (!pieceAssetContainer) console.warn("Piece asset container not found.");
        else if (!asset) console.warn("Image asset not found for:", pieceKey);
        // Fallback text content
        pieceElement.textContent = `${pieceData.player === PLAYERS.ORANGE ? 'O' : 'Y'}${pieceData.rank}`;
        pieceElement.classList.add(pieceData.player); // Add player class for styling fallback
    }

    // Add event listeners (handlers call handleFirstInteraction)
    pieceElement.addEventListener('dragstart', handleDragStart);
    pieceElement.addEventListener('dragend', handleDragEnd);
    pieceElement.addEventListener('touchstart', handleTouchStart, { passive: false });
    pieceElement.addEventListener('touchmove', handleTouchMove, { passive: false });
    pieceElement.addEventListener('touchend', handleTouchEnd);
    pieceElement.addEventListener('click', handlePieceClick);
    // Mouse hover/focus handled by delegated listeners in setupEventListeners now
    // pieceElement.addEventListener('mouseover', handlePieceMouseOver); // Removed
    // pieceElement.addEventListener('mouseout', handlePieceMouseOut);   // Removed

    // Drop handling (allow dropping onto opponent pieces for capture)
    pieceElement.addEventListener('drop', handleDrop);
    pieceElement.addEventListener('dragover', handleDragOver);
    pieceElement.addEventListener('dragenter', handleDragEnterPiece);
    pieceElement.addEventListener('dragleave', handleDragLeavePiece);

    // Update focusedCoords state when a piece receives focus
    pieceElement.addEventListener('focus', () => {
        focusedCoords = coords; // Update global focus tracking
    });
    // Optional: Add blur listener if needed
    // pieceElement.addEventListener('blur', () => {
    //     if (focusedCoords === coords) focusedCoords = null;
    // });


    // Add the trap rank indicator span (initially hidden)
    const indicatorSpan = document.createElement('span');
    indicatorSpan.classList.add('trap-rank-indicator');
    indicatorSpan.textContent = '(0)'; // Indicates rank is effectively 0
    indicatorSpan.setAttribute('aria-hidden', 'true'); // Hide from screen readers initially
    pieceElement.appendChild(indicatorSpan);

    // Draggable attribute is set dynamically by updatePieceAccessibility

    return pieceElement;
}

/**
 * Calculates and sets the absolute CSS position (left, top percentages) for a piece element
 * within the board grid wrapper, ensuring it's centered within its target cell
 * and maintains aspect ratio. **Crucially, updates the element's dataset.coords**.
 * Depends on: getRowCol (utils.js), ROWS, COLS (constants.js). Needs boardGridWrapper element.
 *
 * @param {HTMLElement} element - The piece element to position.
 * @param {string} coords - The algebraic coordinates of the target cell.
 */
function positionElementOnBoard(element, coords) {
    if (!boardGridWrapper) {
        console.error("positionElementOnBoard Error: boardGridWrapper not found.");
        return;
    }
    const rc = getRowCol(coords);
    if (!rc) {
        console.error("positionElementOnBoard Error: Cannot position element, invalid coords:", coords);
        return;
    }
    const { row, col } = rc;

    // Calculate cell dimensions as percentages of the grid wrapper
    const cellWidthPercent = 100 / COLS;
    const cellHeightPercent = 100 / ROWS;

    // Use CSS variables or default if not available
    // Ensure the element is attached to the DOM to get computed style
    let pieceWidthPercent = 12.07; // Default fallback
    let pieceHeightPercent = 9.38; // Default fallback
    if (document.body.contains(element)) {
        const styles = window.getComputedStyle(element);
        pieceWidthPercent = parseFloat(styles.getPropertyValue('--piece-width-percent') || '12.07');
        pieceHeightPercent = parseFloat(styles.getPropertyValue('--piece-height-percent') || '9.38');
    }


    // Calculate the top-left corner of the target cell
    const cellLeftPercent = col * cellWidthPercent;
    const cellTopPercent = row * cellHeightPercent;

    // Calculate the offset needed to center the piece within the cell
    const offsetXPercent = (cellWidthPercent - pieceWidthPercent) / 2;
    const offsetYPercent = (cellHeightPercent - pieceHeightPercent) / 2;

    // Calculate the final top-left position for the piece element
    const finalLeftPercent = cellLeftPercent + offsetXPercent;
    const finalTopPercent = cellTopPercent + offsetYPercent;

    // Apply the calculated position
    element.style.left = `${finalLeftPercent}%`;
    element.style.top = `${finalTopPercent}%`;

    // Reset any transform applied during dragging/animations
    element.style.transform = '';

    // --- CRUCIAL UPDATE ---
    // Update the element's coordinate data attribute to reflect its new logical position
    element.dataset.coords = coords;
    // ----------------------

    // Update aria-label if piece info is available
    const pieceRank = element.dataset.rank;
    const piecePlayer = element.dataset.player;
    if (pieceRank && piecePlayer && RANK_TO_NAME[pieceRank]) {
        element.setAttribute('aria-label', `${piecePlayer} ${RANK_TO_NAME[pieceRank]} at ${coords}`);
    } else {
         // Fallback label if rank/player data missing (shouldn't happen)
         element.setAttribute('aria-label', `Piece at ${coords}`);
    }
}

/**
 * Clears existing visual pieces and places new ones based on the current bitboard state.
 * Applies trap and hungry indicator visuals.
 * Depends on: gameState (gameState.js), BB_IDX, PLAYERS (constants.js),
 *             lsbIndex, bitIndexToCoord, getBit, allTrapsBB (bitboardUtils.js), BB_EMPTY,
 *             createPieceElement, positionElementOnBoard, updateTrapIndicatorVisual,
 *             updateHungryVisual, updateAllPieceAccessibility. Needs boardGridWrapper element.
 */
function placePiecesBB() {
    if (!boardGridWrapper) {
        console.error("placePiecesBB Error: boardGridWrapper element not found.");
        return;
    }
    boardGridWrapper.querySelectorAll('.piece').forEach(p => p.remove());

    const bitboards = gameState.bitboards;
    // Access hungry state
    const hungryOrangeBB = gameState.hungryBB?.[PLAYERS.ORANGE] ?? BB_EMPTY;
    const hungryYellowBB = gameState.hungryBB?.[PLAYERS.YELLOW] ?? BB_EMPTY;

    if (!bitboards || bitboards.length !== BB_IDX.COUNT) {
        console.error("placePiecesBB Error: Invalid gameState.bitboards.");
        return;
    }

    for (let pieceTypeIndex = BB_IDX.PIECE_START; pieceTypeIndex <= BB_IDX.PIECE_END; pieceTypeIndex++) {
        let tempBB = bitboards[pieceTypeIndex];

        while (tempBB !== BB_EMPTY) {
            const lsb = lsbIndex(tempBB);
            if (lsb === -1) break;

            const coords = bitIndexToCoord(lsb);
            if (coords) {
                const rank = (pieceTypeIndex % 8) + 1;
                const player = pieceTypeIndex < 8 ? PLAYERS.ORANGE : PLAYERS.YELLOW;
                const pieceDataForUI = { player: player, rank: rank };

                const pieceElement = createPieceElement(pieceDataForUI, coords);
                boardGridWrapper.appendChild(pieceElement);
                positionElementOnBoard(pieceElement, coords);

                // Apply trap indicator visual
                const isTrapped = getBit(allTrapsBB, lsb) !== 0n;
                updateTrapIndicatorVisual(coords, isTrapped, pieceElement);

                // Apply hungry visual based on loaded state
                const playerHungryBB = player === PLAYERS.ORANGE ? hungryOrangeBB : hungryYellowBB;
                const isHungry = getBit(playerHungryBB, lsb) !== 0n;
                updateHungryVisual(coords, isHungry, pieceElement);

            } else {
                 console.warn(`placePiecesBB: Could not get coords for bit index ${lsb}`);
            }
            tempBB = clearBit(tempBB, lsb);
        }
    }
    updateAllPieceAccessibility();
}


// --- Accessibility and Interaction State ---

/**
 * Updates the tabindex, draggable attributes, AND cursor style (via .movable class)
 * of a piece element based on the current game state (whose turn, game over).
 * Pieces are only interactive for the current player if the game is active.
 * Depends on: gameState (gameState.js).
 * @param {HTMLElement} pieceElement - The piece element to update.
 */
function updatePieceAccessibility(pieceElement) {
    if (!pieceElement || !pieceElement.dataset || !gameState) return;
    const piecePlayer = pieceElement.dataset.player;

    // Determine if the piece should be interactive
    const shouldBeInteractive =
        !gameState.gameOver &&
        piecePlayer === gameState.currentPlayer &&
        // Add check for PvP mode or if it's AI's turn
        (isPlayerVsPlayerMode || gameState.currentPlayer === PLAYERS.ORANGE);

    if (shouldBeInteractive) {
        pieceElement.setAttribute('tabindex', '0'); // Allow focus via keyboard/assistive tech
        pieceElement.draggable = true;             // Allow dragging
        pieceElement.classList.add('movable');     // Add class for hand cursor style
    } else {
        pieceElement.setAttribute('tabindex', '-1'); // Disallow focus via keyboard/assistive tech
        pieceElement.draggable = false;            // Disallow dragging
        pieceElement.classList.remove('movable');  // Remove class for hand cursor style
    }
}

/**
 * Updates accessibility attributes for all piece elements on the board.
 * Typically called after a turn change or game state load.
 * Depends on: updatePieceAccessibility. Needs boardGridWrapper element.
 */
function updateAllPieceAccessibility() {
    if (!boardGridWrapper) return;
    boardGridWrapper.querySelectorAll('.piece').forEach(p => updatePieceAccessibility(p));
}

/**
 * Selects a piece at the given coordinates.
 * Updates the selectedPieceCoords state, applies visual selection style,
 * highlights valid moves, and sets focus.
 * Depends on: deselectPiece, getPieceElementId, gameState (gameState.js),
 *             highlightValidMoves, focusOn.
 * @param {string} coords - The algebraic coordinates of the piece to select.
 */
function selectPiece(coords) {
    deselectPiece(); // Ensure only one piece is selected at a time

    const pieceElement = document.getElementById(getPieceElementId(coords));
    // Only select if it's the current player's piece and game is not over
    if (pieceElement?.dataset.player === gameState.currentPlayer && !gameState.gameOver) {
        selectedPieceCoords = coords; // Update state
        pieceElement.classList.add('selected'); // Apply visual style
        highlightValidMoves(coords, true); // Show valid moves for this piece (apply persistent styles)
        focusOn(coords); // Move focus to the selected piece
    } else {
        clearHighlights(); // Clear any lingering highlights if selection failed
    }
}

/**
 * Deselects the currently selected piece.
 * Clears the selectedPieceCoords state, removes visual selection style,
 * and clears move highlights.
 * Depends on: getPieceElementId, clearHighlights.
 */
function deselectPiece() {
    if (selectedPieceCoords) {
        const pieceElement = document.getElementById(getPieceElementId(selectedPieceCoords));
        if (pieceElement) {
            pieceElement.classList.remove('selected'); // Remove visual style
        }
        selectedPieceCoords = null; // Clear state
        clearHighlights(); // Remove move highlights and reset tabindex
    } else {
        // If nothing was selected, still ensure highlights are cleared
        clearHighlights();
    }
}

/**
 * Enables user interaction with the board (dragging, clicking, keyboard).
 * Sets pointer-events, adds keydown listener, updates piece accessibility,
 * and removes the AI thinking indicator class.
 * Depends on: handleKeyDown, updateAllPieceAccessibility. Needs boardGridWrapper element.
 */
function enablePlayerInteraction() {
    if (!boardGridWrapper) return;
    boardGridWrapper.style.pointerEvents = 'auto'; // Allow clicks/drags on the grid
    document.removeEventListener('keydown', handleKeyDown); // Remove first to prevent duplicates
    document.addEventListener('keydown', handleKeyDown); // Enable keyboard controls
    updateAllPieceAccessibility(); // Make current player's pieces draggable/focusable
    boardGridWrapper.classList.remove('ai-thinking'); // Remove AI thinking indicator
}

/**
 * Disables user interaction with the board.
 * Used during AI's turn or when the game is over. Adds AI thinking indicator if applicable.
 * Depends on: handleKeyDown, updateAllPieceAccessibility, gameState, isPlayerVsPlayerMode, PLAYERS.
 * Needs boardGridWrapper element.
 */
function disablePlayerInteraction() {
    if (!boardGridWrapper) return;
    boardGridWrapper.style.pointerEvents = 'none'; // Prevent clicks/drags on the grid
    document.removeEventListener('keydown', handleKeyDown); // Disable keyboard controls
    updateAllPieceAccessibility(); // Make all pieces non-interactive

    // Add AI thinking indicator class if it's AI's turn in PvE mode
    if (!isPlayerVsPlayerMode && gameState?.currentPlayer === PLAYERS.YELLOW && !gameState?.gameOver) {
        boardGridWrapper.classList.add('ai-thinking');
    } else {
        boardGridWrapper.classList.remove('ai-thinking'); // Ensure class is removed otherwise
    }
}

// --- Centralized Rendering ---

/**
 * Renders the entire game UI based on the provided game state.
 * This function consolidates updates for pieces, turn indicator, clocks,
 * highlights, accessibility, board state display, and undo button.
 * Status message updates might still happen separately based on specific actions.
 * Move log updates (rebuildMoveLog/addLogEntryToDOM) are handled separately.
 *
 * Depends on: placePiecesBB, updateClockDisplay (using global orangeTime/yellowTime),
 *             logBoardStateStringUI, updateUndoButtonState, updateAllPieceAccessibility,
 *             highlightLastMoves, clearHighlights.
 *             Needs turnIndicator element.
 *
 * @param {object} currentState - The game state object (typically the global `gameState`).
 */
function renderGame(currentState) {
    if (!currentState) {
        console.error("renderGame called with invalid state.");
        return;
    }

    // 1. Clear previous highlights (essential before placing pieces/highlighting)
    clearHighlights();

    // 2. Place pieces - NOTE: This is now handled by callers (initializeGame, undoMove)
    // placePiecesBB(); // Relies on global gameState internally for bitboards/hungryBB

    // 3. Update Turn Indicator
    if (turnIndicator) {
        if (currentState.gameOver) {
            turnIndicator.textContent = `Game Over - ${currentState.winner ? currentState.winner.toUpperCase() : 'DRAW'} Wins!`;
            turnIndicator.className = 'game-over';
        } else {
            turnIndicator.textContent = currentState.currentPlayer.toUpperCase();
            turnIndicator.className = currentState.currentPlayer;
        }
    }

    // 4. Update Clocks (using global time variables for now)
    // TODO: Consider passing time via currentState if clocks are moved into gameState
    updateClockDisplay(PLAYERS.ORANGE, orangeTime);
    updateClockDisplay(PLAYERS.YELLOW, yellowTime);

    // 5. Update Board State String Display
    logBoardStateStringUI(); // Relies on global gameState

    // 6. Update Undo Button State
    updateUndoButtonState(); // Relies on global gameState & gameHistory

    // 7. Update Piece Accessibility (Draggable, Focusable)
    updateAllPieceAccessibility(); // Relies on global gameState

    // 8. Highlight Last Moves
    highlightLastMoves(); // Relies on global gameState

    // 9. Set Default Status Message (can be overridden by specific actions)
    if (!currentState.gameOver) {
        updateStatus(`${currentState.currentPlayer.toUpperCase()}'s turn.`);
    } else {
         updateStatus(`Game Over! ${currentState.winner ? currentState.winner.toUpperCase() : 'DRAW'} wins!`);
    }

    // Note: Move log updates (rebuildMoveLog/addLogEntryToDOM) are handled by callers (initializeGame, performMove, undoMove).
    // Note: Specific animations (capture, flash) are handled by callers (performMove).
}


// --- Other UI Update Functions ---

/**
 * Updates the status message display area and logs the message to the console.
 * Depends on: statusMessage element.
 * @param {string} message - The message to display.
 */
function updateStatus(message) {
    if (statusMessage) {
        statusMessage.textContent = message; // Update the DOM element
    }
}

/**
 * Updates the enabled/disabled state of the Undo button based on game history length,
 * game over state, and AI thinking state (if PvE).
 * Depends on: gameHistory (gameState.js), gameState (gameState.js), isPlayerVsPlayerMode.
 * Needs undoButton element.
 */
function updateUndoButtonState() {
    if (!undoButton) return;
    // Disable if history is empty OR game is over OR if PvE & AI's turn
    const isAIThinking = !isPlayerVsPlayerMode && gameState.currentPlayer === PLAYERS.YELLOW;
    undoButton.disabled = gameHistory.length === 0 || gameState.gameOver || isAIThinking;
}

/**
 * Clears and rebuilds the visual move log based on the `gameState.moveHistory` Map.
 * Necessary after loading a previous game state. Iterates over Map values, sorted by turn number.
 * Depends on: gameState (gameState.js), addLogEntryToDOM. Needs moveLogElement.
 */
function rebuildMoveLog() {
    if (!moveLogElement) return;
    moveLogElement.innerHTML = ''; // Clear the current log display

    // Get entries from the Map, convert to array, sort by turn number
    const sortedEntries = Array.from(gameState.moveHistory.values())
        .sort((a, b) => a.turn - b.turn);

    // Add each entry from the sorted array back to the DOM
    sortedEntries.forEach(entry => {
        addLogEntryToDOM(entry.turn, entry.orange, entry.yellow);
    });

    // Scroll to the bottom of the log
    moveLogElement.scrollTop = moveLogElement.scrollHeight;
}

/**
 * Creates and appends a log entry element to the visual move log panel.
 * Adds data-tooltip attribute for hover/focus interaction handled by global listeners.
 * Depends on: generateMoveDescription (utils.js), PLAYERS (constants.js). Needs moveLogElement.
 * @param {number} turn - The turn number.
 * @param {string|null} orangeMove - The notation for Orange's move this turn, or null.
 * @param {string|null} yellowMove - The notation for Yellow's move this turn, or null.
 */
function addLogEntryToDOM(turn, orangeMove, yellowMove) {
    if (!moveLogElement) return;

    const logEntryDiv = document.createElement('div');
    logEntryDiv.classList.add('log-entry');
    logEntryDiv.dataset.turn = turn;

    // Turn Number Span
    const turnSpan = document.createElement('span');
    turnSpan.classList.add('turn-number');
    turnSpan.textContent = `${turn}.\u00A0`; // Use Unicode non-breaking space
    logEntryDiv.appendChild(turnSpan);

    // Helper function to create and configure the move span
    const createMoveSpan = (moveNotation, playerClass) => {
        const span = document.createElement('span');
        span.classList.add(playerClass); // Add player class (e.g., 'log-orange')

        if (moveNotation && moveNotation !== '...') {
            const description = generateMoveDescription(moveNotation); // generateMoveDescription is in utils.js
            span.textContent = moveNotation;
            if (description) {
                span.setAttribute('data-tooltip', description);
                span.setAttribute('tabindex', '0'); // Make focusable for tooltip interaction
                span.setAttribute('role', 'button'); // Treat as interactive element
                span.setAttribute('aria-describedby', 'move-log-tooltip'); // Points to shared tooltip ID
                span.setAttribute('aria-label', `Move: ${description}`); // Provide context
            } else {
                span.style.cursor = 'default'; // No tooltip, not interactive
            }
        } else {
            span.textContent = '...'; // Placeholder
            span.classList.add('placeholder');
            span.style.cursor = 'default';
        }
        return span;
    };

    // Create and append Orange Move Span (always needed)
    const orangeSpan = createMoveSpan(orangeMove, 'log-orange');
    // Add trailing non-breaking space for formatting if it's not a placeholder
    if (orangeSpan.textContent && orangeSpan.textContent !== '...') {
        orangeSpan.textContent += '\u00A0'; // Append non-breaking space
    }
    logEntryDiv.appendChild(orangeSpan);

    // Create and append Yellow Move Span ONLY if yellowMove has a value
    if (yellowMove !== null) { // Check explicitly for null
        const yellowSpan = createMoveSpan(yellowMove, 'log-yellow');
        logEntryDiv.appendChild(yellowSpan);
    }

    moveLogElement.appendChild(logEntryDiv);

    // Scroll only if the log isn't actively being hovered
    if (!moveLogElement.matches(':hover')) {
        moveLogElement.scrollTop = moveLogElement.scrollHeight;
    }
}

/**
 * Logs the current board state using the human-readable string format.
 * Displays the string representation in the UI log element.
 * Depends on: gameState (gameState.js), getBoardStateStringBB (gameLogic.js).
 * Needs boardStateLogElement element.
 * @returns {string} The board state string.
 */
function logBoardStateStringUI() {
    let boardString = "Error generating state string";
    try {
        boardString = getBoardStateStringBB(gameState.bitboards); // Generate string from current bitboards
    } catch (e) {
        console.error("Error generating board state string:", e);
    }

    if (boardStateLogElement) {
        boardStateLogElement.textContent = boardString; // Display the string
    }
    // console.log("Board State String:", boardString); // Log to console if needed

    // Note: We still use the Zobrist hash stored in gameState.boardStateHistory
    // for actual repetition checking in the game logic and AI.
    // This UI log is just for display/copying the visual state.

    return boardString; // Return the generated string
}


/**
 * Shows or hides the "(0)" trap rank indicator on a piece's DOM element.
 * Can accept coordinates OR a direct element reference for robustness.
 * Depends on: getPieceElementId.
 * @param {string} coords - The coordinates of the piece.
 * @param {boolean} isTrapped - Whether the piece should show the trapped indicator.
 * @param {HTMLElement|null} [element=null] - Optional: Direct reference to the piece element.
 */
function updateTrapIndicatorVisual(coords, isTrapped, element = null) {
    const pieceElement = element || document.getElementById(getPieceElementId(coords));
    if (!pieceElement) return; // Element might not exist (e.g., captured)

    const indicatorSpan = pieceElement.querySelector('.trap-rank-indicator');
    if (!indicatorSpan) {
        console.warn("Trap indicator span not found for piece at", coords);
        return;
    }

    if (isTrapped) {
        indicatorSpan.classList.add('visible');
        indicatorSpan.setAttribute('aria-hidden', 'false'); // Make visible to assistive tech
    } else {
        indicatorSpan.classList.remove('visible');
        indicatorSpan.setAttribute('aria-hidden', 'true'); // Hide from assistive tech
    }
}

/**
 * Adds or removes the 'hungry' class from a piece's DOM element.
 * Can accept coordinates OR a direct element reference.
 * Depends on: getPieceElementId.
 * @param {string} coords - The coordinates of the piece (used if element is not provided).
 * @param {boolean} isHungry - Whether the piece should be marked as hungry.
 * @param {HTMLElement|null} [element=null] - Optional: Direct reference to the piece element.
 */
function updateHungryVisual(coords, isHungry, element = null) {
    const pieceElement = element || document.getElementById(getPieceElementId(coords));

    if (pieceElement) {
        if (isHungry) {
            // Only add if not already present
            if (!pieceElement.classList.contains('hungry')) {
                pieceElement.classList.add('hungry');
                // Optional: Add ARIA attribute or description
                // pieceElement.setAttribute('aria-description', 'Hungry');
            }
        } else {
             // Only remove if present
             if (pieceElement.classList.contains('hungry')) {
                 pieceElement.classList.remove('hungry');
                 // Optional: Remove ARIA attribute
                 // pieceElement.removeAttribute('aria-description');
             }
        }
    }
    // else {
    //      console.warn(`updateHungryVisual: Element not found for ${coords}`);
    // }
}

// --- Highlighting and Visual Feedback ---

/**
 * Removes all move/attack highlights and selection styles from cells and pieces.
 * Resets cell tabindex attributes.
 * Depends on: selectedPieceCoords, updateAllPieceAccessibility, focusedCoords, getCellElementId, getPieceElementId.
 * Needs boardGridWrapper element.
 */
function clearHighlights() {
    if (!boardGridWrapper) return;
    // Remove highlight classes from all cells
    boardGridWrapper.querySelectorAll('.cell').forEach(cell => {
        cell.classList.remove('valid-move', 'valid-attack', 'valid-move-highlight', 'valid-attack-highlight');
        cell.setAttribute('tabindex', '-1'); // Reset tabindex
    });

    // If no piece is currently selected, ensure no piece has the 'selected' class
    if (!selectedPieceCoords) {
        boardGridWrapper.querySelectorAll('.piece.selected').forEach(p => p.classList.remove('selected'));
    }
    // Ensure pieces' tabindex is correctly set based on current player/game state
    updateAllPieceAccessibility();

    // Restore tabindex=0 for the currently focused element *if* it should be focusable
    // This prevents losing focus during deselection/highlight clearing.
    if (focusedCoords) {
        const focusedEl = document.getElementById(getCellElementId(focusedCoords)) || document.getElementById(getPieceElementId(focusedCoords));
        if (focusedEl) {
             // Check if the focused element is a piece belonging to the current player
             const isFocusablePiece = focusedEl.matches('.piece') && focusedEl.dataset.player === gameState.currentPlayer && !gameState.gameOver && (isPlayerVsPlayerMode || gameState.currentPlayer === PLAYERS.ORANGE);
             if (isFocusablePiece) {
                 focusedEl.setAttribute('tabindex', '0');
             } else if (!focusedEl.matches('.piece')) {
                 // Cells generally remain non-focusable unless highlighted as valid moves
                 focusedEl.setAttribute('tabindex', '-1');
             }
        }
    }
}


/**
 * Highlights valid move and attack squares for a given piece, using bitboard data and validation.
 * Generates potential moves for the specific piece and validates each one using `isValidMoveBB`.
 * Adds temporary highlight classes ('valid-move-highlight', 'valid-attack-highlight')
 * and, if `isSelection` is true, applies persistent visual styles ('valid-move', 'valid-attack').
 * Depends on: clearHighlights, getPieceData (gameState.js), isValidMoveBB (gameLogic.js),
 *             coordToBitIndex, bitIndexToCoord, lsbIndex, clearBit, setBit, // bitboardUtils.js
 *             checkJumpPathClearBB, waterBB, orangeDenBB, yellowDenBB, // bitboardUtils.js
 *             getPieceTypeIndex (utils.js), getCellElementId, getPieceElementId,
 *             gameState (gameState.js), SPECIAL_ABILITIES, PLAYERS, BB_IDX, SQUARES, COLS, ROWS (constants.js).
 * Needs boardGridWrapper element.
 *
 * @param {string} fromCoords - The coordinates of the piece whose moves to highlight.
 * @param {boolean} [isSelection=true] - If true, apply persistent styles (for click/drag selection).
 *                                      If false, only add highlight classes (for hover).
 */
function highlightValidMoves(fromCoords, isSelection = true) {
    clearHighlights(); // Clear previous highlights first
    if (!boardGridWrapper) return;

    // Get piece data using the function that reads bitboards
    const piece = getPieceData(fromCoords); // Reads global gameState.bitboards

    // Don't highlight if no piece or (if selecting) it's not current player's piece/turn
    if (!piece || (isSelection && piece.player !== gameState.currentPlayer)) {
        return;
    }
    // Additional check: Don't highlight if it's AI's turn in PvE
    if (isSelection && !isPlayerVsPlayerMode && gameState.currentPlayer === PLAYERS.YELLOW) {
        return;
    }

    const fromIndex = coordToBitIndex(fromCoords);
    const movingPieceTypeIndex = getPieceTypeIndex(piece.player, piece.rank);
    if (fromIndex === -1 || movingPieceTypeIndex === -1) {
        console.error("highlightValidMoves Error: Invalid index for piece.", { fromCoords, piece });
        return;
    }

    // --- Generate potential moves for the selected piece ONLY ---
    let targetSquaresBB = BB_EMPTY; // BB of potential destinations
    const rank = piece.rank;
    const abilities = SPECIAL_ABILITIES[rank];
    if (!abilities) {
        console.error(`highlightValidMoves Error: Missing abilities for rank ${rank}`);
        return;
    }

    const isSwimmer = abilities.swims || false;
    const canJumpV = abilities.jumpV || false;
    const canJumpH = abilities.jumpH || false;
    const isFromLand = getBit(waterBB, fromIndex) === 0n;
    const ownPiecesBB = gameState.bitboards[piece.player === PLAYERS.ORANGE ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES];
    const ownDenBB = piece.player === PLAYERS.ORANGE ? orangeDenBB : yellowDenBB;
    const pieceBB = 1n << BigInt(fromIndex);

    // Orthogonal Moves
    let potentialOrthoTargets = BB_EMPTY;
    const fromRow = Math.floor(fromIndex / COLS);
    const fromCol = fromIndex % COLS;
    if (fromRow > 0) potentialOrthoTargets |= (pieceBB >> BigInt(COLS));      // North
    if (fromRow < ROWS - 1) potentialOrthoTargets |= (pieceBB << BigInt(COLS)); // South
    if (fromCol > 0) potentialOrthoTargets |= (pieceBB >> 1n);             // West
    if (fromCol < COLS - 1) potentialOrthoTargets |= (pieceBB << 1n);             // East
    potentialOrthoTargets &= ~ownPiecesBB; // Cannot move onto own pieces
    potentialOrthoTargets &= ~ownDenBB;    // Cannot move into own den
    if (!isSwimmer) potentialOrthoTargets &= ~waterBB; // Non-swimmers cannot enter water
    targetSquaresBB |= potentialOrthoTargets;

    // Jump Moves
    if (isFromLand) {
        let potentialJumpTargets = BB_EMPTY;
        // Vertical Jumps
        if (canJumpV && (fromCol === 1 || fromCol === 2 || fromCol === 4 || fromCol === 5)) {
            if (fromIndex >= 4 * COLS) potentialJumpTargets |= (pieceBB >> BigInt(4 * COLS)); // Jump North
            if (fromIndex < SQUARES - (4 * COLS)) potentialJumpTargets |= (pieceBB << BigInt(4 * COLS)); // Jump South
        }
        // Horizontal Jumps
        if (canJumpH && (fromRow >= 3 && fromRow <= 5)) {
            if (fromCol >= 3) potentialJumpTargets |= (pieceBB >> 3n); // Jump West
            if (fromCol <= COLS - 1 - 3) potentialJumpTargets |= (pieceBB << 3n); // Jump East
        }
        potentialJumpTargets &= ~ownPiecesBB; // Cannot jump onto own pieces
        potentialJumpTargets &= ~ownDenBB;    // Cannot jump into own den
        potentialJumpTargets &= ~waterBB;     // Jumps must land on land

        // Check jump path clear for each potential jump target
        let validJumpTargets = BB_EMPTY;
        let tempJumpTargets = potentialJumpTargets;
        while(tempJumpTargets !== BB_EMPTY) {
            const jumpTargetIdx = lsbIndex(tempJumpTargets);
            if (jumpTargetIdx !== -1 && jumpTargetIdx < SQUARES) {
                 // Use the selected piece's player for the jump path check
                 if (checkJumpPathClearBB(fromIndex, jumpTargetIdx, piece.player, gameState.bitboards)) {
                     validJumpTargets = setBit(validJumpTargets, jumpTargetIdx);
                 }
            } else { break; } // Invalid index or board empty
            tempJumpTargets = clearBit(tempJumpTargets, jumpTargetIdx);
        }
        targetSquaresBB |= validJumpTargets; // Add only the valid jumps
    }
    // --- End generating potential moves ---

    // --- Iterate through potential targets and validate using isValidMoveBB ---
    let currentTargets = targetSquaresBB;
    while (currentTargets !== BB_EMPTY) {
        const toIndex = lsbIndex(currentTargets);
        if (toIndex === -1 || toIndex >= SQUARES) {
            console.warn(`highlightValidMoves: Invalid LSB index ${toIndex} from target BB.`);
            break; // Prevent infinite loop on error
        }
        const toCoords = bitIndexToCoord(toIndex);
        const cell = document.getElementById(getCellElementId(toCoords));

        if (cell && toCoords) {
            // Validate the move fully using isValidMoveBB for the CURRENT player
            const validation = isValidMoveBB(fromIndex, toIndex, movingPieceTypeIndex, gameState.currentPlayer, gameState.bitboards);

            if (validation.valid) {
                // Check if target square is occupied by opponent
                const targetPiece = getPieceData(toCoords); // Reads global gameState.bitboards
                const isAttack = targetPiece && targetPiece.player !== piece.player;

                cell.classList.add('valid-move-highlight'); // Base highlight for any valid move
                if (isAttack) {
                    cell.classList.add('valid-attack-highlight'); // Specific class for attacks
                    if (isSelection) cell.classList.add('valid-attack'); // Persistent style if selecting
                } else {
                    if (isSelection) cell.classList.add('valid-move'); // Persistent style if selecting
                }
                cell.setAttribute('tabindex', '0'); // Make valid destinations focusable by keyboard
            } else {
                // Ensure invalid moves remain non-focusable
                cell.setAttribute('tabindex', '-1');
            }
        }
        currentTargets = clearBit(currentTargets, toIndex);
    }

    // If this is a selection (not just hover), mark the source piece as selected
    if (isSelection) {
        const pieceEl = document.getElementById(getPieceElementId(fromCoords));
        if (pieceEl) pieceEl.classList.add('selected');
    }
}


/**
 * Briefly flashes the background color of a cell for visual feedback.
 * Depends on: getCellElementId.
 * @param {string} coords - The coordinates of the cell to flash.
 * @param {string} [color='red'] - The color to flash ('red' or 'green').
 * @param {number} [duration=300] - The total duration of the flash in milliseconds.
 */
function flashCell(coords, color = 'red', duration = 300) {
    const cell = document.getElementById(getCellElementId(coords));
    if (cell) {
        const originalTransition = cell.style.transition; // Store original transition
        const flashClass = color === 'red' ? 'flash-red' : 'flash-green';

        cell.classList.add(flashClass); // Add class to trigger animation/style

        // Remove the class after the duration
        setTimeout(() => {
            cell.classList.remove(flashClass);
        }, duration);
    }
}

/**
 * Removes the visual highlighting from the last move squares for a specific player.
 * Depends on: gameState (gameState.js), getCellElementId.
 * @param {string} player - The player (PLAYERS.ORANGE or PLAYERS.YELLOW) whose highlights to clear.
 */
function clearPlayerLastMoveHighlight(player) {
    if (!player || !gameState.playerLastMoves || !gameState.playerLastMoves[player]) return;

    const lastMove = gameState.playerLastMoves[player];

    const removeClasses = (coords) => {
        if (!coords) return;
        const cell = document.getElementById(getCellElementId(coords));
        if (cell) {
            cell.classList.remove('last-move-from', 'last-move-to', `${player}-last-move`);
        }
    };

    removeClasses(lastMove.from);
    removeClasses(lastMove.to);
}

/**
 * Highlights the starting and ending squares of the last known moves for both players.
 * Depends on: gameState (gameState.js), getCellElementId. Needs boardGridWrapper element.
 */
function highlightLastMoves() {
    if (!boardGridWrapper || !gameState.playerLastMoves) return;

    // Clear ALL existing last-move highlights first
    boardGridWrapper.querySelectorAll('.cell.last-move-from, .cell.last-move-to, .cell.orange-last-move, .cell.yellow-last-move').forEach(cell => {
        cell.classList.remove('last-move-from', 'last-move-to', 'orange-last-move', 'yellow-last-move');
    });

    // Apply highlights for each player based on gameState.playerLastMoves
    for (const player in gameState.playerLastMoves) {
         // Ensure player key exists and is own property
         if (Object.prototype.hasOwnProperty.call(gameState.playerLastMoves, player)) {
            const move = gameState.playerLastMoves[player];
            if (move && move.from && move.to) {
                const fromCell = document.getElementById(getCellElementId(move.from));
                const toCell = document.getElementById(getCellElementId(move.to));

                if (fromCell) {
                    fromCell.classList.add('last-move-from');
                    fromCell.classList.add(`${player}-last-move`); // Add player class (e.g., 'orange-last-move')
                }
                if (toCell) {
                    toCell.classList.add('last-move-to');
                    toCell.classList.add(`${player}-last-move`); // Add player class
                }
            }
         }
    }
}


// --- Event Handlers ---

// Drag and Drop Handlers
/**
 * Handles the start of a drag operation on a piece.
 * Sets up data transfer, highlights valid moves, applies dragging styles, and hides tooltips.
 * Depends on: gameState (gameState.js), highlightValidMoves, hideSharedTooltip. Calls handleFirstInteraction.
 * @param {DragEvent} e - The drag event object.
 */
function handleDragStart(e) {
    hideSharedTooltip(); // Hide tooltip immediately on drag start
    handleFirstInteraction(); // Register interaction
    const pieceDiv = e.target.closest('.piece');

    // Validate drag start conditions
    if (!pieceDiv || gameState.gameOver || pieceDiv.dataset.player !== gameState.currentPlayer ||
        (!isPlayerVsPlayerMode && gameState.currentPlayer === PLAYERS.YELLOW)) {
        e.preventDefault(); // Prevent drag if not allowed
        return;
    }

    isDragging = true;
    draggedPieceElement = pieceDiv;
    sourceCoords = draggedPieceElement.dataset.coords; // Store starting position

    // Use setTimeout to allow the browser to render the drag image before hiding the original
    setTimeout(() => {
        if (draggedPieceElement) {
            // Apply 'dragging' style (e.g., opacity) AFTER the drag image is created
            draggedPieceElement.classList.add('dragging');
        }
    }, 0);

    e.dataTransfer.effectAllowed = 'move';
    // Use try-catch for older browser compatibility with setData
    try {
        // Set data for drop handler (can be anything, sourceCoords is useful)
        e.dataTransfer.setData('text/plain', sourceCoords);
        // Set a custom drag image (optional, makes it look better)
        // e.dataTransfer.setDragImage(pieceDiv, pieceDiv.offsetWidth / 2, pieceDiv.offsetHeight / 2);
    } catch (error) {
        console.warn("DataTransfer operations might not be fully supported:", error);
    }

    highlightValidMoves(sourceCoords, true); // Show potential destinations and select piece
    // selectedPieceCoords is set by highlightValidMoves when isSelection=true
}

/**
 * Handles the end of a drag operation (whether successful drop or cancelled).
 * Cleans up dragging styles and resets related state variables.
 * Depends on: clearHighlights, positionElementOnBoard, deselectPiece.
 * @param {DragEvent} e - The drag event object.
 */
function handleDragEnd(e) {

    if (draggedPieceElement) {
        // Remove dragging style immediately
        draggedPieceElement.classList.remove('dragging');
        // Ensure opacity/transform are reset if the drop wasn't on a valid target
        // If dropped successfully, performMove handles final positioning.
        // If cancelled, snap back (or rely on browser default).
        // Let's explicitly ensure styles are cleared if it still exists.
        if(document.body.contains(draggedPieceElement)) {
             draggedPieceElement.style.opacity = '';
             draggedPieceElement.style.transform = '';
        }
    }

    // If the drag was cancelled outside a valid target, ensure the piece snaps back.
    // This might be redundant if the browser handles it, but provides fallback.
    // Check if a move was actually performed (selectedPieceCoords would be null)
    // If sourceCoords still exists and selectedPieceCoords is also sourceCoords (meaning no move happened)
    // AND the element still exists, reposition it.
    if (isDragging && sourceCoords && selectedPieceCoords === sourceCoords && draggedPieceElement && document.body.contains(draggedPieceElement)) {
         positionElementOnBoard(draggedPieceElement, sourceCoords); // Snap back visually
    }


    // Reset drag-related flags and references
    isDragging = false;
    draggedPieceElement = null;
    sourceCoords = null;

    // Deselect piece and clear highlights UNLESS a move was successfully performed
    // (performMove calls deselectPiece)
     if (selectedPieceCoords) {
        deselectPiece(); // This also calls clearHighlights()
     } else {
         clearHighlights(); // Ensure highlights are cleared even if no piece was selected
     }
}


/**
 * Handles the drag over event on potential drop targets (cells, pieces).
 * Prevents the default behavior to allow dropping.
 * @param {DragEvent} e - The drag event object.
 */
function handleDragOver(e) {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
}

/**
 * Helper function to apply hover styling during drag based on the target element.
 * Adds 'valid-move' or 'valid-attack' class to the underlying cell if it's a valid target.
 * @param {HTMLElement} targetElement - The element being dragged over (cell or piece).
 */
function handleDragEnterAny(targetElement) {
    if (!targetElement || !isDragging) return;
    const targetCoords = getCoordsFromElement(targetElement);
    const cellElement = targetCoords ? document.getElementById(getCellElementId(targetCoords)) : null;

    // Check if the underlying cell was highlighted as a potential move/attack
    if (cellElement && cellElement.classList.contains('valid-move-highlight')) {
        // Apply the appropriate hover style based on whether it's an attack or move square
        if (cellElement.classList.contains('valid-attack-highlight')) {
            cellElement.classList.add('valid-attack'); // Red highlight
        } else {
            cellElement.classList.add('valid-move'); // Green highlight
        }
    }
}

/**
 * Helper function to remove hover styling when the dragged piece leaves an element.
 * @param {HTMLElement} targetElement - The element being left.
 */
function handleDragLeaveAny(targetElement) {
    if (!targetElement) return;
    const targetCoords = getCoordsFromElement(targetElement);
    const cellElement = targetCoords ? document.getElementById(getCellElementId(targetCoords)) : null;
    // Remove the temporary hover styles
    if (cellElement) {
        cellElement.classList.remove('valid-move', 'valid-attack');
    }
}

/** Handles drag enter event specifically for cell elements. @param {DragEvent} e */
function handleDragEnter(e) {
    e.preventDefault();
    handleDragEnterAny(e.target); // Use helper for styling
}

/** Handles drag leave event specifically for cell elements. @param {DragEvent} e */
function handleDragLeave(e) {
    handleDragLeaveAny(e.target); // Use helper for styling
}

/** Handles drag enter event specifically for piece elements (potential capture targets). @param {DragEvent} e */
function handleDragEnterPiece(e) {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling to the underlying cell
    handleDragEnterAny(e.target.closest('.piece')); // Target the piece element
}

/** Handles drag leave event specifically for piece elements. @param {DragEvent} e */
function handleDragLeavePiece(e) {
    handleDragLeaveAny(e.target.closest('.piece')); // Target the piece element
}

/**
 * Handles the drop event when a piece is released over a target.
 * Validates the move using bitboards (isValidMoveBB) and triggers performMove if valid.
 * Depends on: isDragging, sourceCoords, draggedPieceElement, getCoordsFromElement,
 *             clearHighlights, getPieceData (gameState.js), isValidMoveBB (gameLogic.js),
 *             coordToBitIndex (bitboardUtils.js), getPieceTypeIndex (utils.js),
 *             performMove (main scope wrapper), updateStatus, playSound (audio.js), flashCell.
 *             Calls handleFirstInteraction.
 * @param {DragEvent} e - The drop event object.
 */
function handleDrop(e) {
    e.preventDefault();
    handleFirstInteraction(); // Register interaction
    clearHighlights(); // Clear visual highlights from drag phase first

    if (!isDragging || !sourceCoords || !draggedPieceElement) {
        // Cleanup potentially lingering state (dragEnd might not fire reliably on errors)
        isDragging = false;
        draggedPieceElement = null;
        sourceCoords = null;
        deselectPiece();
        return;
    }

    const dragSourceCoords = sourceCoords; // Use coords stored on dragStart

    // Determine target coordinates from the drop event target
    const targetElement = e.target;
    let targetCoords = getCoordsFromElement(targetElement);

    // If dropped on own piece, treat as invalid target
    const droppedOnPiece = targetElement?.closest('.piece');
    if (droppedOnPiece && droppedOnPiece.dataset.player === gameState.currentPlayer) {
         targetCoords = null; // Invalid target
    }

    // --- Attempt to Perform Move ---
    if (targetCoords && targetCoords !== dragSourceCoords) {
        // Perform the move (calls performMoveBB internally)
        performMove(dragSourceCoords, targetCoords); // Assumes performMove exists in main scope

    } else {
        // Dropped on invalid target (outside board, own piece, or same square)
        updateStatus("Invalid drop location.");
        playSound(errorSoundElement, "Error Sound");
        // Snap piece back visually (dragEnd might handle cleanup, but do it here too)
        if (draggedPieceElement && document.body.contains(draggedPieceElement)) {
             positionElementOnBoard(draggedPieceElement, dragSourceCoords);
        }
         // Explicitly deselect after invalid drop
         deselectPiece();
    }

    // Reset drag state (dragEnd will also run, but reset here for clarity)
    // draggedPieceElement and sourceCoords are reset by handleDragEnd
    // selectedPieceCoords is reset by performMove->deselectPiece or the deselectPiece call above
    isDragging = false; // Ensure this is false after drop processing
}


// --- Touch Handlers ---

/**
 * Handles the start of a touch interaction on a piece.
 * Initiates potential drag, stores start position, highlights moves.
 * Depends on: gameState, isDragging, highlightValidMoves. Calls handleFirstInteraction.
 * @param {TouchEvent} e - The touch event object.
 */
function handleTouchStart(e) {
    handleFirstInteraction();
    if (gameState.gameOver) return;

    const pieceElement = e.target.closest('.piece');
    // Validate touch start conditions
    if (!pieceElement || pieceElement.dataset.player !== gameState.currentPlayer ||
       (!isPlayerVsPlayerMode && gameState.currentPlayer === PLAYERS.YELLOW)) {
        return;
    }

    e.preventDefault(); // Prevent default touch behavior like scrolling or zooming

    // Clear previous selection/drag state
    deselectPiece(); // Clear any previous selection highlights
    isDragging = false; // Reset drag flag
    draggedPieceElement = pieceElement;
    sourceCoords = draggedPieceElement.dataset.coords;

    // Store initial touch coordinates for calculating movement delta
    const touch = e.changedTouches[0];
    touchStartCoords = { x: touch.clientX, y: touch.clientY };

    // Apply selected style and highlight moves
    draggedPieceElement.classList.add('selected');
    highlightValidMoves(sourceCoords, true); // Apply persistent highlights
    selectedPieceCoords = sourceCoords; // Track selection

    // Temporarily disable smooth transition for direct manipulation feel
    draggedPieceElement.style.transition = 'none';
    draggedPieceElement.style.zIndex = '100'; // Bring to front
}

/**
 * Handles touch movement while holding a piece.
 * Updates the piece's position visually using transform and detects if it's a drag vs. tap.
 * Applies temporary hover highlights on cells underneath the touch point. Hides tooltip on drag start.
 * Depends on: isDragging, draggedPieceElement, touchStartCoords, getCoordsFromElement, getCellElementId, hideSharedTooltip.
 * @param {TouchEvent} e - The touch event object.
 */
function handleTouchMove(e) {
    if (!draggedPieceElement || !sourceCoords) return; // Only if a piece touch is active
    e.preventDefault(); // Prevent scrolling during piece drag

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartCoords.x;
    const deltaY = touch.clientY - touchStartCoords.y;

    // Define a threshold to distinguish between a tap and a drag
    const touchDragThreshold = 10; // Pixels

    // If not already dragging, check if threshold is exceeded
    if (!isDragging && (Math.abs(deltaX) > touchDragThreshold || Math.abs(deltaY) > touchDragThreshold)) {
        hideSharedTooltip(); // Hide tooltip as soon as dragging starts
        isDragging = true; // It's now officially a drag
        draggedPieceElement.classList.add('dragging'); // Apply dragging style (e.g., scale/opacity)
    }

    // If dragging, update the element's visual position using transform
    if (isDragging) {
        // Preserve scaling if already applied by the 'dragging' class
        const currentTransform = window.getComputedStyle(draggedPieceElement).transform;
        let currentScale = 1;
        if (currentTransform && currentTransform !== 'none') {
            const matrix = new DOMMatrixReadOnly(currentTransform);
            currentScale = matrix.a; // Assuming uniform scaling stored in 'a' and 'd'
        }
        // Apply translation based on touch movement and maintain scale
        draggedPieceElement.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${currentScale})`;

        // --- Update cell highlighting based on finger position ---
        // Hide the dragged element temporarily to find element underneath
        draggedPieceElement.style.visibility = 'hidden';
        const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
        draggedPieceElement.style.visibility = 'visible'; // Make it visible again

        // First, remove existing temporary hover highlights from all cells
        boardGridWrapper.querySelectorAll('.cell.valid-move, .cell.valid-attack').forEach(c => c.classList.remove('valid-move', 'valid-attack'));

        // Find the cell under the touch point
        const targetCoords = getCoordsFromElement(elementUnderTouch);
        const cellUnderTouch = targetCoords ? document.getElementById(getCellElementId(targetCoords)) : null;

        // If over a potentially valid move cell, apply the temporary hover highlight
        if (cellUnderTouch && cellUnderTouch.classList.contains('valid-move-highlight')) {
            if (cellUnderTouch.classList.contains('valid-attack-highlight')) {
                cellUnderTouch.classList.add('valid-attack'); // Red highlight
            } else {
                cellUnderTouch.classList.add('valid-move'); // Green highlight
            }
        }
    }
}


/**
 * Handles the end of a touch interaction (lifting the finger).
 * Determines if it was a tap (treat like click) or a drag (treat like drop).
 * Validates dragged moves using bitboards (isValidMoveBB). Cleans up styles and hides tooltips.
 * Depends on: isDragging, draggedPieceElement, sourceCoords, touchStartCoords,
 *             getCoordsFromElement, clearHighlights, getPieceData (gameState.js),
 *             isValidMoveBB (gameLogic.js), performMove (main scope wrapper),
 *             updateStatus, playSound (audio.js), positionElementOnBoard, deselectPiece, hideSharedTooltip.
 * @param {TouchEvent} e - The touch event object.
 */
function handleTouchEnd(e) {
    hideSharedTooltip(); // Hide tooltip on touch end

    // Ensure we have tracked data from touchstart
    if (!draggedPieceElement || !sourceCoords) {
        isDragging = false; // Reset flag just in case
        draggedPieceElement = null;
        sourceCoords = null;
        return;
    }
    e.preventDefault();

    const elementBeingReleased = draggedPieceElement; // Keep reference for cleanup
    const startingCoords = sourceCoords; // Keep reference for validation/snap back
    const wasDragging = isDragging; // Check if it was considered a drag

    // --- Cleanup visual styles immediately ---
    elementBeingReleased.classList.remove('dragging', 'selected'); // Remove dragging AND selection
    elementBeingReleased.style.opacity = '';
    elementBeingReleased.style.zIndex = ''; // Reset z-index
    elementBeingReleased.style.transform = ''; // Clear transform immediately
    elementBeingReleased.style.transition = ''; // Restore default transition (or remove inline)

    // --- Reset state flags early ---
    isDragging = false;
    draggedPieceElement = null;
    sourceCoords = null;
    selectedPieceCoords = null; // Clear selection regardless of tap/drag outcome here

    clearHighlights(); // Clear move highlights

    // --- If it wasn't a drag, treat it as a tap/click ---
    if (!wasDragging) {
        // Simulate a click on the original element for selection/deselection logic
        const targetPiece = document.getElementById(getPieceElementId(startingCoords));
        if (targetPiece) {
            targetPiece.click(); // Trigger the click handler
        }
        return; // Exit, let click handler manage selection state
    }

    // --- If it WAS a drag ---
    const touch = e.changedTouches[0];
    // Temporarily hide the element to find what's underneath accurately
    elementBeingReleased.style.visibility = 'hidden';
    const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
    elementBeingReleased.style.visibility = 'visible'; // Show it again

    let targetCoords = getCoordsFromElement(elementUnderTouch);

    // If dropped on own piece, treat as invalid target
    const droppedOnPiece = elementUnderTouch?.closest('.piece');
    if (droppedOnPiece && droppedOnPiece.dataset.player === elementBeingReleased.dataset.player) {
        targetCoords = null; // Invalid target
    }

    // --- Validate and Perform Move ---
    if (targetCoords && targetCoords !== startingCoords) {
        // Perform the move (calls performMoveBB internally)
        performMove(startingCoords, targetCoords); // Assumes performMove exists in main scope

    } else { // Dropped outside board, on own piece, same square, or invalid target element
        // Only play error sound if dropped somewhere other than the start square
        if (targetCoords !== startingCoords) {
            playSound(errorSoundElement, "Error Sound");
            updateStatus("Invalid drop location.");
        }
        // Snap the original element back if it still exists
        const originalElement = document.getElementById(getPieceElementId(startingCoords));
        if (originalElement) {
            positionElementOnBoard(originalElement, startingCoords);
        }
        // Deselection and highlight clearing already happened
    }

    // --- Final cleanup for touch drag state ---
    // Flags/refs (isDragging, draggedPieceElement, sourceCoords, selectedPieceCoords) are reset above.
    // Highlights are cleared above.
}


// --- Click Handlers ---

/**
 * Handles clicking on a piece. Selects/deselects own piece or attempts capture.
 * Reads bitboards via getPieceData. Validates potential captures using isValidMoveBB.
 * Depends on: isDragging, gameState, selectedPieceCoords, getPieceData (gameState.js),
 *             deselectPiece, selectPiece, isValidMoveBB (gameLogic.js), performMove (main scope wrapper),
 *             flashCell, updateStatus, playSound (audio.js), clearHighlights.
 *             Calls handleFirstInteraction.
 * @param {MouseEvent} e - The click event object.
 */
function handlePieceClick(e) {
    handleFirstInteraction();
    if (isDragging || gameState.gameOver) return; // Ignore clicks during drag or game over

    const pieceElement = e.currentTarget; // Use currentTarget for the element the listener is attached to
    if (!pieceElement || !pieceElement.classList.contains('piece')) return;

    const clickedCoords = pieceElement.dataset.coords;
    if (!clickedCoords) return;

    const clickedPieceData = getPieceData(clickedCoords); // Reads bitboards

    // --- Case 1: A piece is already selected ---
    if (selectedPieceCoords) {
        // Clicking the *same* selected piece? -> Deselect
        if (selectedPieceCoords === clickedCoords) {
            deselectPiece();
        }
        // Clicking a *different* piece?
        else {
            const selectedPieceData = getPieceData(selectedPieceCoords); // Data for the already selected piece
            if (!selectedPieceData) { deselectPiece(); return; } // Safety check

            // Clicking an *opponent's* piece? -> Attempt Capture
            if (clickedPieceData && clickedPieceData.player !== selectedPieceData.player) {
                 performMove(selectedPieceCoords, clickedCoords); // performMove handles validation & outcome
            }
            // Clicking *another friendly* piece? -> Switch Selection
            else if (clickedPieceData && clickedPieceData.player === selectedPieceData.player) {
                 selectPiece(clickedCoords); // selectPiece calls deselectPiece first
            }
            // Clicking an empty square (event propagated from piece)? -> Let cell handler deal with it
            else if (!clickedPieceData) {
                // This shouldn't typically happen if click is on piece element, but handle defensively.
                // Let handleCellClick manage moves to empty squares.
            }
        }
    }
    // --- Case 2: No piece selected ---
    else {
        // Clicking a *friendly* piece? -> Select it
        if (clickedPieceData && clickedPieceData.player === gameState.currentPlayer &&
           (isPlayerVsPlayerMode || gameState.currentPlayer === PLAYERS.ORANGE)) { // Check if player can interact
            selectPiece(clickedCoords);
        }
        // Clicking an *opponent's* piece? -> Do nothing (or provide feedback)
        else if (clickedPieceData && clickedPieceData.player !== gameState.currentPlayer) {
             flashCell(clickedCoords, 'red', 300);
             playSound(errorSoundElement, "Error Sound");
             clearHighlights();
        }
        // Clicking an empty square? -> Let cell handler deal with it (this handler shouldn't fire)
    }
}

/**
 * Handles clicking on a cell. If a piece is selected, attempts to move it there.
 * Uses bitboard validation (isValidMoveBB).
 * Depends on: isDragging, gameState, selectedPieceCoords, getPieceData (gameState.js),
 *             isValidMoveBB (gameLogic.js), performMove (main scope wrapper),
 *             flashCell, updateStatus, playSound (audio.js), deselectPiece, clearHighlights.
 *             Calls handleFirstInteraction.
 * @param {MouseEvent} e - The click event object.
 */
function handleCellClick(e) {
    handleFirstInteraction();
    const targetCell = e.currentTarget;
    if (!targetCell || !targetCell.classList.contains('cell') || !targetCell.dataset.coords) return;

    const targetCoords = targetCell.dataset.coords;

    if (isDragging || gameState.gameOver) return; // Ignore clicks during drag or game over

    // If a piece IS selected, attempt move to the clicked cell
    if (selectedPieceCoords) {
        performMove(selectedPieceCoords, targetCoords); // performMove handles validation & outcome
    }
    // If no piece is selected, clicking a cell does nothing useful
    else {
        clearHighlights(); // Ensure no highlights remain if clicking empty cell
    }
}

// --- Hover Handlers ---

/**
 * Handles mouse entering a piece element. Shows potential moves if it's the player's piece
 * and no other piece is currently selected or being dragged. (Hover effect)
 * Depends on: gameState, selectedPieceCoords, isDragging, getPieceData (gameState.js), highlightValidMoves.
 * @param {MouseEvent} e - The mouse event object.

function handlePieceMouseOver(e) {
    const pieceElement = e.target.closest('.piece');
    // Ignore if game over, another piece is selected, dragging, or not a piece
    if (!pieceElement || gameState.gameOver || selectedPieceCoords || isDragging) return;

    const coords = pieceElement.dataset.coords;
    const pieceData = getPieceData(coords); // Reads global gameState

    // Only highlight moves on hover for the current player's pieces IF they can interact
    if (pieceData && pieceData.player === gameState.currentPlayer &&
        (isPlayerVsPlayerMode || gameState.currentPlayer === PLAYERS.ORANGE)) {
        // Highlight moves but DON'T apply persistent styles (isSelection = false)
        highlightValidMoves(coords, false);
    }
}
 */

/**
 * Handles mouse leaving a piece element. Clears temporary hover highlights
 * if no piece is actively selected or being dragged.
 * Depends on: selectedPieceCoords, isDragging, clearHighlights.
 * @param {MouseEvent} e - The mouse event object.

function handlePieceMouseOut(e) {
    // If no piece is selected and not dragging, clear any highlights shown on hover
    if (!selectedPieceCoords && !isDragging) {
        clearHighlights();
    }
}
 */

// --- Keyboard Handlers ---

/**
 * Handles keyboard navigation (arrow keys) and actions (Enter/Space, Escape)
 * for moving focus, selecting/deselecting pieces, and making moves.
 * Ignores input if the "Load State" input field is focused or interaction disabled.
 * Depends on: isLoadStateInputFocused, gameState, isPlayerVsPlayerMode, focusedCoords,
 *             getCoords, getRowCol (utils.js), getPieceElementId, getCellElementId,
 *             getPieceData (gameState.js), deselectPiece, selectPiece, performMove (main scope wrapper),
 *             flashCell, updateStatus, playSound (audio.js), focusOn, clearHighlights.
 *             Calls handleFirstInteraction.
 * @param {KeyboardEvent} e - The keyboard event object.
 */
function handleKeyDown(e) {
    if (isLoadStateInputFocused) return; // Ignore if typing in load state input

    // Ignore if game over or AI's turn in PvE
    if (gameState.gameOver || (!isPlayerVsPlayerMode && gameState.currentPlayer === PLAYERS.YELLOW)) {
        return;
    }

    handleFirstInteraction(); // Register interaction

    const { key } = e;
    let newRow, newCol, targetCoords;

    // --- Initialize focus if not set ---
    if (!focusedCoords) {
        // Try to focus the first movable piece of the current player
        const firstMovablePiece = boardGridWrapper?.querySelector(`.piece[data-player="${gameState.currentPlayer}"][tabindex="0"]`);
        if (firstMovablePiece) {
            focusOn(firstMovablePiece.dataset.coords);
        } else {
            // Fallback: Focus roughly center of the board
            focusOn(getCoords(Math.floor(ROWS / 2), Math.floor(COLS / 2)) || 'd5');
        }
        // If still no focus after trying, exit
        if (!focusedCoords) return;
    }

    const currentRC = getRowCol(focusedCoords);
    if (!currentRC) {
        console.warn("Keyboard nav: Invalid focusedCoords", focusedCoords);
        // Attempt to recover focus
        const firstMovablePiece = boardGridWrapper?.querySelector(`.piece[data-player="${gameState.currentPlayer}"][tabindex="0"]`);
        if (firstMovablePiece) focusOn(firstMovablePiece.dataset.coords);
        return;
    }

    // --- Handle Arrow Key Navigation ---
    let handled = false;
    switch (key) {
        case 'ArrowUp': newRow = currentRC.row - 1; newCol = currentRC.col; handled = true; break;
        case 'ArrowDown': newRow = currentRC.row + 1; newCol = currentRC.col; handled = true; break;
        case 'ArrowLeft': newRow = currentRC.row; newCol = currentRC.col - 1; handled = true; break;
        case 'ArrowRight': newRow = currentRC.row; newCol = currentRC.col + 1; handled = true; break;
    }

    if (handled) {
        e.preventDefault(); // Prevent page scrolling
        targetCoords = getCoords(newRow, newCol);
        if (targetCoords) {
            focusOn(targetCoords); // Move focus to the new square
        }
        return; // Navigation handled, exit
    }

    // --- Handle Action Keys (Enter/Space, Escape) ---
    switch (key) {
        case 'Enter':
        case ' ': // Spacebar
            e.preventDefault();
            const focusedElement = document.getElementById(getPieceElementId(focusedCoords)) || document.getElementById(getCellElementId(focusedCoords));
            if (!focusedElement) return;

            // Action on a PIECE
            if (focusedElement.classList.contains('piece')) {
                const pieceData = getPieceData(focusedCoords);
                // Can only interact with own pieces
                if (pieceData?.player === gameState.currentPlayer) {
                    if (selectedPieceCoords === focusedCoords) {
                        deselectPiece(); // Deselect if clicking selected piece again
                    } else {
                        selectPiece(focusedCoords); // Select if clicking a friendly piece
                    }
                } else {
                     playSound(errorSoundElement, "Error Sound"); // Cannot select opponent piece
                }
            }
            // Action on a CELL (only if a piece is selected)
            else if (focusedElement.classList.contains('cell') && selectedPieceCoords) {
                 performMove(selectedPieceCoords, focusedCoords); // Attempt move
            }
             // Action on a CELL (no piece selected)
             else if (focusedElement.classList.contains('cell') && !selectedPieceCoords) {
                 playSound(errorSoundElement, "Error Sound"); // Cannot move nothing
             }
            return;

        case 'Escape':
            e.preventDefault();
            if (selectedPieceCoords) {
                deselectPiece(); // Deselect the current piece
            } else {
                clearHighlights(); // Clear any stray highlights (e.g., from hover)
            }
             // Optionally move focus back to the board container or a default element
             // boardElement.focus();
            return;
    }
}

/**
 * Programmatically sets focus on a specific cell or piece element by its coordinates.
 * Updates the internal `focusedCoords` state via the element's focus listener.
 * Depends on: getPieceElementId, getCellElementId.
 * @param {string|null} coords - The algebraic coordinates of the target element, or null.
 */
function focusOn(coords) {
    if (!coords) return;
    // Find the target element (piece first, then cell)
    // Piece takes precedence if both exist at coords (piece is visually on top)
    let targetElement = document.getElementById(getPieceElementId(coords)) || document.getElementById(getCellElementId(coords));

    if (targetElement) {
        // Check if the target should be focusable before focusing
        const isPiece = targetElement.classList.contains('piece');
        const isCell = targetElement.classList.contains('cell');
        let shouldFocus = false;

        if (isPiece) {
             // Focus piece if it's current player's and game on (and player turn if PvE)
             shouldFocus = targetElement.dataset.player === gameState.currentPlayer &&
                           !gameState.gameOver &&
                           (isPlayerVsPlayerMode || gameState.currentPlayer === PLAYERS.ORANGE);
        } else if (isCell) {
             // Focus cell only if it's highlighted as a valid move destination
             shouldFocus = targetElement.classList.contains('valid-move-highlight');
        }

        if (shouldFocus) {
             targetElement.focus(); // Set browser focus
             // The element's 'focus' event listener will update the global focusedCoords
        } else {
            // If target shouldn't be focused, maybe focus the board container?
            // Or just don't change focus. Let's do nothing for now.
            // console.log(`Prevented focus on non-interactive target: ${coords}`);
        }
    }
}


// --- Button Click Handlers ---

/**
 * Handles the click event for the Copy Log button.
 * Extracts text from the move log, formats it, and copies it to the clipboard.
 * Provides user feedback on the button.
 * Depends on: moveLogElement, copyLogButton elements.
 */
function handleCopyLogClick() {
    if (!copyLogButton || !moveLogElement) return;
    handleFirstInteraction(); // Register interaction

    const logEntries = moveLogElement.querySelectorAll('.log-entry');
    if (logEntries.length === 0) {
        copyLogButton.textContent = "Log Empty"; // Updated feedback text
        copyLogButton.disabled = true;
        setTimeout(() => {
            copyLogButton.textContent = "Copy"; // Reset text
            copyLogButton.disabled = false;
        }, 1500);
        return;
    }

    // Extract text content from each entry, preserving spacing.
    const logLines = Array.from(logEntries).map(entry => {
        // Get text, normalize spaces (replace multiple spaces/tabs with single space), trim ends.
        return entry.textContent.replace(/\s+/g, ' ').trim();
    });
    const formattedLogText = logLines.join('\n'); // Join lines with newline characters

    if (!navigator.clipboard) {
        console.error("Clipboard API not available. Cannot copy.");
        copyLogButton.textContent = "Copy Failed";
        setTimeout(() => { copyLogButton.textContent = "Copy"; }, 2000); // Reset text
        return;
    }

    // Use the Clipboard API to write the text
    navigator.clipboard.writeText(formattedLogText).then(() => {
        const originalText = "Copy"; // Updated default text
        copyLogButton.textContent = "Copied! ✅"; // Use checkmark for success
        copyLogButton.disabled = true;
        setTimeout(() => {
            copyLogButton.textContent = originalText;
            copyLogButton.disabled = false;
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy move log: ', err);
        copyLogButton.textContent = "Copy Failed ❌"; // Use cross mark for error
        setTimeout(() => { copyLogButton.textContent = "Copy"; }, 2000); // Reset text
    });
}

/**
 * Handles the click event for the Copy State button.
 * Extracts the board state hash string from its display element and copies it to the clipboard.
 * Provides user feedback on the button.
 * Depends on: boardStateLogElement, copyStateButton elements.
 */
function handleCopyStateClick() {
    if (!copyStateButton || !boardStateLogElement) return;
    handleFirstInteraction(); // Register interaction

    // Extract the hash, removing the "Hash: " prefix
    const fullText = boardStateLogElement.textContent || '';
    const stateString = fullText.replace(/^Hash:\s*/, '').trim();

    if (!stateString || stateString === 'N/A') {
        copyStateButton.textContent = "State Empty"; // Updated feedback text
        copyStateButton.disabled = true;
        setTimeout(() => {
            copyStateButton.textContent = "Copy"; // Reset text
            copyStateButton.disabled = false;
        }, 1500);
        return;
    }

    if (!navigator.clipboard) {
        console.error("Clipboard API not available. Cannot copy.");
        copyStateButton.textContent = "Copy Failed";
        setTimeout(() => { copyStateButton.textContent = "Copy"; }, 2000); // Reset text
        return;
    }

    // Use the Clipboard API to write the text
    navigator.clipboard.writeText(stateString).then(() => {
        const originalText = "Copy"; // Updated default text
        copyStateButton.textContent = "Copied! ✅";
        copyStateButton.disabled = true;
        setTimeout(() => {
            copyStateButton.textContent = originalText;
            copyStateButton.disabled = false;
        }, 1500);
    }).catch(err => {
        console.error('Failed to copy board state hash: ', err);
        copyStateButton.textContent = "Copy Failed ❌";
        setTimeout(() => { copyStateButton.textContent = "Copy"; }, 2000); // Reset text
    });
}


// --- Shared Tooltip Logic ---

/**
 * Shows the shared tooltip positioned near the target element with the specified content.
 * Handles multiline content and allows HTML rendering for elements like icons.
 * Depends on: sharedMoveTooltip element, tooltipHideTimeout.
 * @param {HTMLElement} targetElement - The element triggering the tooltip (e.g., the move span or piece).
 * @param {string} content - The string content (potentially containing HTML) to display in the tooltip.
 */
function showSharedTooltip(targetElement, content) {
    if (!targetElement || !sharedMoveTooltip || !content) {
        hideSharedTooltip(); // Hide if target/tooltip missing or no content
        return;
    }

    // Clear any pending hide timeout
    if (tooltipHideTimeout) {
        clearTimeout(tooltipHideTimeout);
        tooltipHideTimeout = null;
    }

    // *** Use innerHTML to render the span correctly ***
    sharedMoveTooltip.innerHTML = content; // Set the HTML content
    // *** ------------------------------------------ ***

    sharedMoveTooltip.style.display = 'block'; // Use display block for measurement
    sharedMoveTooltip.style.visibility = 'hidden'; // Keep hidden while calculating size/pos
    sharedMoveTooltip.style.opacity = '0';

    // Get dimensions after setting text
    const targetRect = targetElement.getBoundingClientRect();
    const tooltipRect = sharedMoveTooltip.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    // Calculate position (prefer above, centered)
    let top = targetRect.top + scrollY - tooltipRect.height - 8; // Position above target + margin
    let left = targetRect.left + scrollX + (targetRect.width / 2) - (tooltipRect.width / 2); // Center horizontally

    // Adjust if tooltip goes off-screen top
    if (top < scrollY + 5) { // Use a small buffer from the top edge
        top = targetRect.bottom + scrollY + 8; // Position below instead
    }

    // Adjust if tooltip goes off-screen left/right
    const viewportWidth = document.documentElement.clientWidth;
    if (left < scrollX + 5) { // Small buffer from left edge
        left = scrollX + 5;
    } else if (left + tooltipRect.width > scrollX + viewportWidth - 5) { // Small buffer from right edge
        left = scrollX + viewportWidth - tooltipRect.width - 5;
    }

    // Apply position and make visible with transition
    sharedMoveTooltip.style.top = `${top}px`;
    sharedMoveTooltip.style.left = `${left}px`;
    sharedMoveTooltip.style.visibility = 'visible';
    sharedMoveTooltip.style.opacity = '1';
    sharedMoveTooltip.setAttribute('aria-hidden', 'false');
}

/**
 * Hides the shared tooltip, potentially with a delay.
 * Depends on: sharedMoveTooltip element, tooltipHideTimeout.
 */
function hideSharedTooltip() {
    // Use a small timeout to prevent flickering when moving mouse between adjacent triggers
    if (tooltipHideTimeout) clearTimeout(tooltipHideTimeout); // Clear existing timeout

    tooltipHideTimeout = setTimeout(() => {
        if (sharedMoveTooltip) {
            sharedMoveTooltip.style.opacity = '0';
            sharedMoveTooltip.setAttribute('aria-hidden', 'true');
             // Use another timeout to set visibility hidden after transition completes
             setTimeout(() => {
                 // Check opacity again in case showSharedTooltip was called in the meantime
                 if (sharedMoveTooltip.style.opacity === '0') {
                     sharedMoveTooltip.style.visibility = 'hidden';
                     sharedMoveTooltip.style.display = 'none'; // Hide completely
                 }
             }, 200); // Match transition duration in CSS (or slightly longer)
        }
        tooltipHideTimeout = null;
    }, 100); // 100ms delay before starting fade out
}


// --- Initialization of UI Elements and Listeners ---

/**
 * Gets references to all required DOM elements.
 * Should be called once the DOM is loaded.
 * @returns {boolean} True if all essential elements were found, false otherwise.
 */
function initializeDOMElements() {
    boardElement = document.getElementById('board');
    boardGridWrapper = document.getElementById('board-grid-wrapper');
    turnIndicator = document.getElementById('turn-indicator');
    statusMessage = document.getElementById('status-message');
    resetButton = document.getElementById('reset-button');
    undoButton = document.getElementById('undo-button');
    moveLogElement = document.getElementById('move-log');
    copyLogButton = document.getElementById('copy-log-button');
    boardStateLogElement = document.getElementById('board-state-log');
    copyStateButton = document.getElementById('copy-state-button');
    pieceAssetContainer = document.getElementById('piece-assets');
    debugLogContainer = document.getElementById('debug-log-container');
    debugLogOutput = document.getElementById('debug-log-output');
    clearDebugLogButton = document.getElementById('clear-debug-log');
    orangeClockContainer = document.getElementById('orange-clock-container');
    yellowClockContainer = document.getElementById('yellow-clock-container');
    orangeClockTimeElement = document.getElementById('orange-clock-time');
    yellowClockTimeElement = document.getElementById('yellow-clock-time');
    sharedMoveTooltip = document.getElementById('move-log-tooltip');
    loadStateButton = document.getElementById('load-state-button');
    boardStateInput = document.getElementById('board-state-input');
    loadStatusMessage = document.getElementById('load-status-message');
    rulesButton = document.getElementById('rules-toggle-button');
    rulesContent = document.getElementById('rules-content');
    pvpToggleButton = document.getElementById('pvp-toggle');
    musicVolumeSlider = document.getElementById('music-volume-slider');
    musicVolumeDisplay = document.getElementById('music-volume-display');
    sfxToggleCheckbox = document.getElementById('sfx-toggle');

    // Validate essential elements
    if (!boardGridWrapper || !turnIndicator || !statusMessage || !resetButton || !undoButton || !moveLogElement) {
        console.error("CRITICAL UI INIT ERROR: Essential game elements not found!");
        return false;
    }
     if (!orangeClockTimeElement || !yellowClockTimeElement) {
         console.warn("UI INIT WARNING: Clock time elements not found.");
     }
    if (!pieceAssetContainer) {
         console.warn("UI INIT WARNING: Piece asset container not found. Piece images may not load.");
     }
    // Add checks for other optional elements if their absence breaks functionality

    return true;
}

/**
 * Sets up all the main event listeners for UI elements and delegated listeners for dynamic content.
 * Should be called once after elements are initialized.
 * Relies on the handler functions defined in this file and functions from other modules.
 * Depends on: initializeGame, undoMove (main.js), handleCopyLogClick, handleCopyStateClick,
 *             handleFirstInteraction (audio.js), parseBoardStateStringBB (gameLogic.js),
 *             isPlayerVsPlayerMode, aiMoveTimeoutId, triggerAIMove (main.js),
 *             pauseAllClocks, resumeClockForCurrentPlayer, playTurnSound (main.js),
 *             updateAllPieceAccessibility, updateUndoButtonState, showSharedTooltip, hideSharedTooltip,
 *             generatePieceInfoTooltipContent (utils.js), generateMoveDescription (utils.js), // Still needed for addLogEntryToDOM
 *             logToPanel (debug.js), soundEffectsEnabled, backgroundMusicElement (audio.js),
 *             pieceTooltipTimeoutId (ui.js). // Added pieceTooltipTimeoutId
 *             Needs various DOM elements referenced globally in ui.js.
 */
function setupEventListeners() {
    // --- Core Game Buttons ---
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            handleFirstInteraction();
            initializeGame(); // Assumes initializeGame is available from main scope
        });
    }
    if (undoButton) {
        undoButton.addEventListener('click', () => {
            handleFirstInteraction();
            undoMove(); // Assumes undoMove is available from main scope
        });
    }

    // --- Log Copy Buttons ---
    if (copyLogButton) {
        copyLogButton.addEventListener('click', handleCopyLogClick);
    } else { console.warn("Copy Log button not found."); }

    if (copyStateButton) {
        copyStateButton.addEventListener('click', handleCopyStateClick);
    } else { console.warn("Copy State button not found."); }

    // --- Load State Functionality ---
    if (loadStateButton && boardStateInput && loadStatusMessage) {
        loadStateButton.addEventListener('click', () => {
            handleFirstInteraction();
            const stateString = boardStateInput.value.trim();

            if (!stateString) {
                loadStatusMessage.textContent = "Please paste a state string first.";
                loadStatusMessage.className = 'load-status error';
                return;
            }

            // Attempt to parse the string directly into bitboards
            const loadedBitboards = parseBoardStateStringBB(stateString); // Use the BB parser

            if (loadedBitboards) {
                // --- Load state directly from bitboards ---
                // Pass true for isLoadingFromState to preserve PvP toggle etc.
                initializeGame(loadedBitboards, true); // Pass bitboard array directly
                loadStatusMessage.textContent = "Board state loaded successfully!";
                loadStatusMessage.className = 'load-status success';
                boardStateInput.value = '';
                boardStateInput.placeholder = 'Paste board state (e.g., 8A3,7g1,...)';
                // --- End loading logic ---

            } else {
                // parseBoardStateStringBB returned null (error during parsing)
                loadStatusMessage.textContent = "Invalid state string format. Check console.";
                loadStatusMessage.className = 'load-status error';
                boardStateInput.classList.add('input-error');
                boardStateInput.placeholder = 'Invalid Format!';
                setTimeout(() => {
                    boardStateInput.classList.remove('input-error');
                    boardStateInput.placeholder = 'Paste board state (e.g., 8A3,7g1,...)';
                }, 2500);
            }
        });
        boardStateInput.addEventListener('focus', () => { isLoadStateInputFocused = true; });
        boardStateInput.addEventListener('blur', () => { isLoadStateInputFocused = false; });
    } else {
        console.warn("Load State elements (button, input, or status) not found.");
    }

    // --- Rules Accordion ---
    if (rulesButton && rulesContent) {
        rulesButton.addEventListener('click', () => {
            handleFirstInteraction();
            const isExpanded = rulesButton.getAttribute('aria-expanded') === 'true';
            rulesButton.setAttribute('aria-expanded', !isExpanded);
            rulesContent.setAttribute('aria-hidden', isExpanded);
            rulesButton.classList.toggle('active');
            rulesContent.classList.toggle('expanded');
            const buttonTextSpan = rulesButton.querySelector('.rules-button-text');
            if (buttonTextSpan) buttonTextSpan.textContent = isExpanded ? 'Show Game Rules' : 'Hide Game Rules';
            if (!isExpanded) { rulesContent.style.maxHeight = rulesContent.scrollHeight + 'px'; } else { rulesContent.style.maxHeight = null; }
        });
    } else { console.warn("Rules accordion elements not found."); }

    // --- PvP Toggle ---
    if (pvpToggleButton) {
        pvpToggleButton.addEventListener('change', (event) => {
            handleFirstInteraction();
            isPlayerVsPlayerMode = event.target.checked;
            console.log(`Player vs Player mode ${isPlayerVsPlayerMode ? 'ENABLED' : 'DISABLED'}`);
            if (aiMoveTimeoutId) { clearTimeout(aiMoveTimeoutId); aiMoveTimeoutId = null; }
            pauseAllClocks();
            if (isPlayerVsPlayerMode) {
                enablePlayerInteraction();
                updateStatus(`${gameState.currentPlayer.toUpperCase()}'s turn (PvP Mode)`);
            } else {
                if (gameState.currentPlayer === PLAYERS.YELLOW && !gameState.gameOver) {
                    disablePlayerInteraction();
                    updateStatus(`${gameState.currentPlayer.toUpperCase()}'s turn (AI Thinking...)`);
                    aiMoveTimeoutId = setTimeout(triggerAIMove, 100);
                } else {
                    enablePlayerInteraction();
                    updateStatus(`${gameState.currentPlayer.toUpperCase()}'s turn (PvE Mode)`);
                }
            }
            if (!gameState.gameOver) {
                resumeClockForCurrentPlayer();
                playTurnSound();
            }
            updateAllPieceAccessibility();
            updateUndoButtonState();
        });
    } else { console.warn("PvP toggle button not found."); }

    // --- Audio Controls ---
    if (musicVolumeSlider && backgroundMusicElement) {
        musicVolumeSlider.addEventListener('input', (event) => {
            handleFirstInteraction();
            const sliderPosition = parseFloat(event.target.value);
            const actualVolume = sliderPosition * 0.1;
            backgroundMusicElement.volume = actualVolume;
            localStorage.setItem('clestoMusicVolume', sliderPosition.toString());
            if (musicVolumeDisplay) { musicVolumeDisplay.textContent = `${Math.round(sliderPosition * 100)}%`; }
        });
    }
    if (sfxToggleCheckbox) {
        sfxToggleCheckbox.addEventListener('change', (event) => {
            handleFirstInteraction();
            soundEffectsEnabled = event.target.checked;
            localStorage.setItem('clestoSfxEnabled', soundEffectsEnabled.toString());
        });
    }

    // --- Tooltip Listeners (Delegated from containers) ---
    if (sharedMoveTooltip) {
        // For Move Log entries
        if (moveLogElement) {
            moveLogElement.addEventListener('mouseover', (event) => {
                const target = event.target.closest('[data-tooltip]');
                if (target && target.dataset.tooltip) {
                    showSharedTooltip(target, target.dataset.tooltip);
                }
            });
            moveLogElement.addEventListener('focusin', (event) => {
                const target = event.target.closest('[data-tooltip]');
                if (target && target.dataset.tooltip) {
                    showSharedTooltip(target, target.dataset.tooltip);
                }
            });
            moveLogElement.addEventListener('mouseout', (event) => {
                const target = event.target.closest('[data-tooltip]');
                if (target) hideSharedTooltip();
            });
            moveLogElement.addEventListener('focusout', (event) => {
                if (!moveLogElement.contains(event.relatedTarget)) { hideSharedTooltip(); }
            });
        } else { console.warn("Move log element not found for tooltips."); }

        // For Piece Info (with delay)
        if (boardGridWrapper) {
            const showPieceTooltip = (target) => {
                if (target && target.dataset.rank) {
                    const rank = parseInt(target.dataset.rank, 10);
                    const content = generatePieceInfoTooltipContent(rank);
                    if (content) showSharedTooltip(target, content);
                }
            };

            const startPieceTooltipTimer = (target) => {
                 if (pieceTooltipTimeoutId) clearTimeout(pieceTooltipTimeoutId); // Clear existing timer
                 pieceTooltipTimeoutId = setTimeout(() => {
                     showPieceTooltip(target);
                     pieceTooltipTimeoutId = null; // Clear ID after showing
                 }, 1500); // 1.5 second delay
            };

            const cancelPieceTooltipTimer = () => {
                 if (pieceTooltipTimeoutId) {
                     clearTimeout(pieceTooltipTimeoutId);
                     pieceTooltipTimeoutId = null;
                 }
                 hideSharedTooltip(); // Hide immediately on mouseout/focusout
            };

            boardGridWrapper.addEventListener('mouseover', (event) => {
                const target = event.target.closest('.piece');
                if (target) {
                    startPieceTooltipTimer(target);
                }
            });
            boardGridWrapper.addEventListener('focusin', (event) => {
                const target = event.target.closest('.piece');
                 if (target) {
                    startPieceTooltipTimer(target);
                 }
            });
            boardGridWrapper.addEventListener('mouseout', (event) => {
                const target = event.target.closest('.piece');
                if (target) {
                     cancelPieceTooltipTimer();
                }
            });
            boardGridWrapper.addEventListener('focusout', (event) => {
                const target = event.target.closest('.piece');
                // Hide if focus moves outside the board wrapper entirely
                if (target && !boardGridWrapper.contains(event.relatedTarget)) {
                    cancelPieceTooltipTimer();
                }
            });
        } else { console.warn("Board grid wrapper not found for piece tooltips.") }

        // Global listener to hide tooltip on Escape key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                 if (pieceTooltipTimeoutId) clearTimeout(pieceTooltipTimeoutId); // Clear timer on escape
                 pieceTooltipTimeoutId = null;
                 hideSharedTooltip();
            }
        });

    } else { console.warn("Shared tooltip element not found. Tooltips disabled."); }

    // --- Debug Panel Listener ---
    if (clearDebugLogButton && debugLogOutput) {
        clearDebugLogButton.addEventListener('click', () => {
            debugLogOutput.innerHTML = '';
            logToPanel('log', ["Debug log cleared."]);
        });
    }
}

// --- Export (if using modules) ---
// export { initializeUI, updateUI, updateStatus, ... };
