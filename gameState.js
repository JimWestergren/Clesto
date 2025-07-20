/**
 * @fileoverview Manages the core game state, including bitboards, turn, history,
 * Zobrist hashing, and state cloning/saving/loading.
 */

// --- Game State Variables ---

/**
 * Holds the current state of the game.
 * Initialized by initializeGameState().
 * @type {{
 *   bitboards: bigint[],
 *   currentPlayer: string,
 *   turnNumber: number,
 *   moveHistory: Map<number, {turn: number, orange: string|null, yellow: string|null}>,
 *   boardStateHistory: Object.<string, number>,
 *   gameOver: boolean,
 *   winner: string|null,
 *   zobristHash: bigint,
 *   hungryBB?: {orange: bigint, yellow: bigint}, // Optional: For hunger/starvation TODO
 *   playerLastMoves: Object.<string, {from: string|null, to: string|null}> // For UI highlighting
 * }}
 */
let gameState = {};

/**
 * Stores previous game states for the undo functionality.
 * Each element is a snapshot created by saveGameState().
 * @type {Array<object>}
 */
let gameHistory = [];

/**
 * Stores Zobrist keys for hashing game states.
 * Initialized by initZobrist().
 * @type {{
 *   pieceKeys?: Array<Array<bigint>>,
 *   turnKey?: bigint
 * }}
 */
let zobristKeys = {};

/**
 * Transposition Table (Hash Map) for AI search memoization.
 * Stores { depth, score, type, bestMove } keyed by Zobrist hash (string).
 * @type {Map<string, {depth: number, score: number, type: number, bestMove: object|null}>}
 */
let transpositionTable = new Map();


// --- Zobrist Hashing ---

/**
 * Initializes the Zobrist keys for piece/square combinations, player turn, and hungry status.
 * MUST be called after initializeBitboardCoordMapping.
 * Depends on: NUM_PIECE_TYPES, SQUARES, PLAYERS (constants.js), generateRandomBigInt (utils.js).
 * Populates: zobristKeys.pieceKeys, zobristKeys.turnKey, zobristKeys.hungryKeys.
 */
function initZobrist() {
    // Ensure coordinate mapping is ready (should be called by main init sequence)
    if (Object.keys(coordToBitIndexCache).length === 0) {
        console.warn("initZobrist called before coordinate mapping was initialized. Attempting lazy init.");
        initializeBitboardCoordMapping();
        if (Object.keys(coordToBitIndexCache).length === 0) {
            console.error("CRITICAL ERROR: Failed to initialize coordinate mapping before Zobrist keys.");
            return;
        }
    }

    // Check if already initialized (check for the new hungryKeys as well)
    if (zobristKeys.turnKey && zobristKeys.hungryKeys) {
        return;
    }

    console.log("Initializing Zobrist keys...");
    zobristKeys.pieceKeys = []; // [pieceTypeIndex][squareIndex] -> BigInt key
    for (let i = 0; i < NUM_PIECE_TYPES; i++) {
        zobristKeys.pieceKeys[i] = [];
        for (let j = 0; j < SQUARES; j++) {
            zobristKeys.pieceKeys[i][j] = generateRandomBigInt();
        }
    }

    zobristKeys.turnKey = generateRandomBigInt(); // Key to XOR when it's Yellow's turn

    // Initialize hungry keys [playerIndex][squareIndex]
    zobristKeys.hungryKeys = [[], []]; // 0 for Orange, 1 for Yellow
    for (let playerIdx = 0; playerIdx < 2; playerIdx++) {
        for (let sqIdx = 0; sqIdx < SQUARES; sqIdx++) {
            zobristKeys.hungryKeys[playerIdx][sqIdx] = generateRandomBigInt();
        }
    }

    console.log("Zobrist keys initialized (including hungry state).");
}

/**
 * Computes the Zobrist hash for a given bitboard state, current player, and hungry state.
 * Depends on: zobristKeys, BB_IDX, PLAYERS (constants.js), lsbIndex, clearBit, getBit (bitboardUtils.js).
 * @param {bigint[]} bitboards - The bitboard array.
 * @param {string} currentPlayer - The player whose turn it is (PLAYERS.ORANGE or PLAYERS.YELLOW).
 * @param {{orange: bigint, yellow: bigint}} hungryState - The hungry bitboards for both players.
 * @returns {bigint} The computed Zobrist hash. Returns 0n if keys are not initialized.
 */
function computeZobristHashBB(bitboards, currentPlayer, hungryState) {
    let hash = 0n;
    // Ensure Zobrist keys are initialized
    if (!zobristKeys.pieceKeys || !zobristKeys.turnKey || !zobristKeys.hungryKeys) {
        console.error("computeZobristHashBB Error: Zobrist keys not initialized!");
        // Attempt lazy initialization - might help in some scenarios but indicates an init order issue
        initZobrist();
        if (!zobristKeys.pieceKeys || !zobristKeys.turnKey || !zobristKeys.hungryKeys) {
            return 0n; // Return 0 if init failed
        }
    }
     // Validate hungryState structure
     if (!hungryState || typeof hungryState.orange !== 'bigint' || typeof hungryState.yellow !== 'bigint') {
        console.error("computeZobristHashBB Error: Invalid hungryState provided!");
        // Decide how to handle this - maybe use global gameState.hungryBB or return 0n?
        // Let's try using global state as a fallback, but log the error.
        if (gameState && gameState.hungryBB) {
            hungryState = gameState.hungryBB;
            console.warn("computeZobristHashBB: Using global hungryBB as fallback due to invalid input.");
        } else {
             return 0n; // Cannot proceed without valid hungry state
        }
    }

    // --- Hash Pieces ---
    for (let pieceTypeIndex = BB_IDX.PIECE_START; pieceTypeIndex <= BB_IDX.PIECE_END; pieceTypeIndex++) {
        let tempBB = bitboards[pieceTypeIndex];
        while (tempBB !== BB_EMPTY) {
            const lsb = lsbIndex(tempBB);
            if (lsb !== -1 && lsb < SQUARES) {
                if (!zobristKeys.pieceKeys[pieceTypeIndex] || typeof zobristKeys.pieceKeys[pieceTypeIndex][lsb] !== 'bigint') {
                    console.error(`computeZobristHashBB Error: Missing Zobrist key for piece ${pieceTypeIndex} at square ${lsb}`);
                } else {
                    hash ^= zobristKeys.pieceKeys[pieceTypeIndex][lsb];
                }
                tempBB = clearBit(tempBB, lsb);
            } else {
                console.error(`computeZobristHashBB Error: Invalid LSB (${lsb}) from non-empty bitboard for type ${pieceTypeIndex}.`);
                break;
            }
        }
    }

    // --- Hash Turn ---
    if (currentPlayer === PLAYERS.YELLOW) {
        hash ^= zobristKeys.turnKey;
    }

    // --- Hash Hungry State ---
    const playerIndices = { [PLAYERS.ORANGE]: 0, [PLAYERS.YELLOW]: 1 };
    for (const player of [PLAYERS.ORANGE, PLAYERS.YELLOW]) {
        const playerIdx = playerIndices[player];
        let hungryBoard = hungryState[player];
        while (hungryBoard !== BB_EMPTY) {
            const lsb = lsbIndex(hungryBoard);
            if (lsb !== -1 && lsb < SQUARES) {
                // Ensure the hungry key exists
                if (!zobristKeys.hungryKeys[playerIdx] || typeof zobristKeys.hungryKeys[playerIdx][lsb] !== 'bigint') {
                    console.error(`computeZobristHashBB Error: Missing Zobrist key for hungry ${player} at square ${lsb}`);
                } else {
                    hash ^= zobristKeys.hungryKeys[playerIdx][lsb];
                }
                hungryBoard = clearBit(hungryBoard, lsb);
            } else {
                console.error(`computeZobristHashBB Error: Invalid LSB (${lsb}) from non-empty hungry bitboard for ${player}.`);
                break;
            }
        }
    }

    return hash;
}

/**
 * Incrementally updates the Zobrist hash by toggling (XORing) the key
 * for a specific player's hungry status at a given square index.
 * Used when a piece becomes hungry or stops being hungry.
 * Depends on: zobristKeys, SQUARES, PLAYERS (constants.js).
 * @param {bigint} currentHash - The current hash value.
 * @param {string} player - The player whose hungry status is changing (PLAYERS.ORANGE or PLAYERS.YELLOW).
 * @param {number} squareIndex - The bit index (0-62) of the square.
 * @returns {bigint} The updated hash value. Returns currentHash if inputs are invalid or keys missing.
 */
function toggleHungryKeyBB(currentHash, player, squareIndex) {
    const playerIndex = (player === PLAYERS.ORANGE) ? 0 : (player === PLAYERS.YELLOW) ? 1 : -1;

    // Basic validation
    if (playerIndex === -1 || squareIndex < 0 || squareIndex >= SQUARES) {
        console.warn(`toggleHungryKeyBB: Invalid player (${player}) or squareIndex (${squareIndex})`);
        return currentHash;
    }
    // Check if keys are initialized and the specific key exists
    if (!zobristKeys.hungryKeys?.[playerIndex]?.[squareIndex]) {
        console.error(`toggleHungryKeyBB: Zobrist key missing for hungry ${player}, square ${squareIndex}. Cannot update hash.`);
        // initZobrist(); // Avoid re-initializing here
        return currentHash;
    }
    return currentHash ^ zobristKeys.hungryKeys[playerIndex][squareIndex];
}

/**
 * Incrementally updates the Zobrist hash by toggling (XORing) the key
 * for a specific piece type at a given square index.
 * Used when a piece is added or removed from a square.
 * Depends on: zobristKeys, BB_IDX, SQUARES (constants.js).
 * @param {bigint} currentHash - The current hash value.
 * @param {number} pieceTypeIndex - The index (0-15) of the piece type.
 * @param {number} squareIndex - The bit index (0-62) of the square.
 * @returns {bigint} The updated hash value. Returns currentHash if inputs are invalid.
 */
function togglePieceKeyBB(currentHash, pieceTypeIndex, squareIndex) {
    // Basic validation
    if (pieceTypeIndex < BB_IDX.PIECE_START || pieceTypeIndex > BB_IDX.PIECE_END || squareIndex < 0 || squareIndex >= SQUARES) {
        console.warn(`togglePieceKeyBB: Invalid pieceTypeIndex (${pieceTypeIndex}) or squareIndex (${squareIndex})`);
        return currentHash;
    }
    // Check if keys are initialized and the specific key exists
    if (!zobristKeys.pieceKeys?.[pieceTypeIndex]?.[squareIndex]) {
        console.error(`togglePieceKeyBB: Zobrist key missing for pieceType ${pieceTypeIndex}, square ${squareIndex}. Cannot update hash.`);
        // Attempt re-initialization? Or just return current hash? Returning current hash is safer.
        // initZobrist(); // Risky if called repeatedly
        return currentHash;
    }
    return currentHash ^ zobristKeys.pieceKeys[pieceTypeIndex][squareIndex];
}

/**
 * Incrementally updates the Zobrist hash by toggling (XORing) the turn key.
 * Used when the current player changes.
 * Depends on: zobristKeys.
 * @param {bigint} currentHash - The current hash value.
 * @returns {bigint} The updated hash value. Returns currentHash if turn key is missing.
 */
function toggleTurnKey(currentHash) {
    if (!zobristKeys.turnKey) {
        console.error("toggleTurnKey Error: Zobrist turn key not initialized!");
        return currentHash; // Return unmodified hash if key is missing
    }
    return currentHash ^ zobristKeys.turnKey;
}

// TODO: Add toggleHungryKeyBB(currentHash, player, squareIndex) if implementing hungryBB hashing

// --- Game State Initialization & Management ---

/**
 * Creates the initial game state object structure, including hungryBB.
 * Depends on: PLAYERS, BB_IDX (constants.js), BB_EMPTY (bitboardUtils.js).
 * @returns {object} The initialized gameState object structure.
 */
function createInitialGameState() {
    return {
        bitboards: new Array(BB_IDX.COUNT).fill(BB_EMPTY),
        currentPlayer: PLAYERS.ORANGE,
        turnNumber: 1,
        moveHistory: new Map(),
        boardStateHistory: {},
        gameOver: false,
        winner: null,
        zobristHash: 0n,
        hungryBB: { // Initialize hungry state
            [PLAYERS.ORANGE]: BB_EMPTY,
            [PLAYERS.YELLOW]: BB_EMPTY
        },
        playerLastMoves: {
            [PLAYERS.ORANGE]: { from: null, to: null },
            [PLAYERS.YELLOW]: { from: null, to: null }
        }
    };
}

/**
 * Creates and initializes the dynamic bitboard array based on a starting board object.
 * Depends on: initializeBitboardCoordMapping, initializeTerrainBitboards, BB_IDX (constants.js),
 *             coordToBitIndex (bitboardUtils.js), getPieceTypeIndex (utils.js), setBit (bitboardUtils.js),
 *             PLAYERS (constants.js).
 * @param {object} startBoardObj - Board object like INITIAL_SETUP { coords: pieceData }.
 * @returns {bigint[]|null} The initialized bitboard array, or null on critical error.
 */
function setupBitboardsFromObject(startBoardObj) {
    // Ensure mappings are ready (should be called by main init sequence)
    if (Object.keys(coordToBitIndexCache).length === 0 || waterBB === BB_EMPTY) {
         console.error("setupBitboardsFromObject Error: Mappings or terrain not initialized.");
         // Attempt lazy init
         initializeBitboardCoordMapping();
         initializeTerrainBitboards();
         if (Object.keys(coordToBitIndexCache).length === 0 || waterBB === BB_EMPTY) {
             return null; // Return null if critical dependencies are missing
         }
    }

    const bitboards = new Array(BB_IDX.COUNT).fill(BB_EMPTY);

    for (const coords in startBoardObj) {
        // Ensure it's a property of the object itself, not inherited
        if (Object.prototype.hasOwnProperty.call(startBoardObj, coords)) {
            const pieceData = startBoardObj[coords];
            if (pieceData) {
                const bitIndex = coordToBitIndex(coords);
                const pieceTypeIndex = getPieceTypeIndex(pieceData.player, pieceData.rank);

                // Determine the correct player index for the combined bitboard
                const playerIndex = (pieceData.player === PLAYERS.ORANGE) ? BB_IDX.ORANGE_PIECES : BB_IDX.YELLOW_PIECES;

                if (bitIndex !== -1 && pieceTypeIndex !== -1 && playerIndex !== -1) {
                    // Set bit in specific piece type board
                    bitboards[pieceTypeIndex] = setBit(bitboards[pieceTypeIndex], bitIndex);
                    // Set bit in combined player board
                    bitboards[playerIndex] = setBit(bitboards[playerIndex], bitIndex);
                } else {
                    console.error(`Error setting up bitboard for piece Rank:${pieceData.rank} Player:${pieceData.player} at ${coords}. Indices: bit=${bitIndex}, type=${pieceTypeIndex}, playerBB=${playerIndex}`);
                    // Continue processing other pieces even if one fails
                }
            }
        }
    }

    // Calculate combined occupied board
    bitboards[BB_IDX.OCCUPIED] = bitboards[BB_IDX.ORANGE_PIECES] | bitboards[BB_IDX.YELLOW_PIECES];

    return bitboards;
}


/**
 * Retrieves piece data (player, rank) for a given coordinate by checking the bitboards.
 * *** Does NOT return hungry status - caller must manage that separately if needed. ***
 * Depends on: coordToBitIndex (bitboardUtils.js), BB_IDX, PLAYERS (constants.js), getBit (bitboardUtils.js).
 * @param {string} coords - The algebraic coordinates (e.g., 'a1').
 * @param {bigint[]} [currentBitboards=gameState.bitboards] - Optional: The bitboards to check. Defaults to global gameState.
 * @returns {{player: string, rank: number}|null} The piece data object or null if empty/invalid.
 */
function getPieceData(coords, currentBitboards = gameState.bitboards) {
    if (!coords) return null;
    const bitIndex = coordToBitIndex(coords);
    if (bitIndex === -1) return null; // Invalid coords

    // Check if bitboards array is valid
    if (!currentBitboards || currentBitboards.length < BB_IDX.PIECE_END + 1) {
        console.error("getPieceData Error: Invalid or incomplete bitboards array provided.");
        return null;
    }

    // Check each piece type bitboard
    for (let pieceTypeIndex = BB_IDX.PIECE_START; pieceTypeIndex <= BB_IDX.PIECE_END; pieceTypeIndex++) {
        // Check if the bit for this square is set in the current piece type's board
        if (getBit(currentBitboards[pieceTypeIndex], bitIndex) !== 0n) {
            // Found the piece type
            const rank = (pieceTypeIndex % 8) + 1; // 0-7 -> 1-8, 8-15 -> 1-8
            const player = pieceTypeIndex < 8 ? PLAYERS.ORANGE : PLAYERS.YELLOW;

            return {
                player: player,
                rank: rank
                // Note: isHungry is intentionally omitted. Manage hungry state separately.
                // Note: Abilities (swims etc.) are not stored/returned; use SPECIAL_ABILITIES[rank].
            };
        }
    }

    return null; // No piece found at this coordinate
}


// --- State Cloning, Saving, Loading ---

/**
 * Creates an efficient deep copy of the essential parts of the game state
 * required for AI simulation (using bitboards), including hungry state.
 * Avoids copying large, unnecessary structures like moveHistory.
 * Includes the Zobrist hash.
 * Depends on: BB_IDX, PLAYERS (constants.js).
 * @param {object} sourceGameState - The gameState object to clone.
 * @returns {object|null} A new object containing deep copies of the essential simulation state, or null on critical error.
 */
function cloneGameStateForSimulation(sourceGameState) {
    // Validate essential properties
    if (!sourceGameState || typeof sourceGameState !== 'object' ||
        !Array.isArray(sourceGameState.bitboards) || sourceGameState.bitboards.length !== BB_IDX.COUNT ||
        !sourceGameState.currentPlayer || typeof sourceGameState.zobristHash !== 'bigint' ||
        !sourceGameState.hungryBB) // Check for hungryBB existence
    {
        console.error("cloneGameStateForSimulation Error: Invalid input gameState object.", sourceGameState);
        return null;
    }

    // Copy bitboards (array of BigInts) - shallow copy is sufficient
    const bitboardsCopy = [...sourceGameState.bitboards];

    // Copy hungry bitboards
    const hungryBBCopy = {
        [PLAYERS.ORANGE]: sourceGameState.hungryBB[PLAYERS.ORANGE],
        [PLAYERS.YELLOW]: sourceGameState.hungryBB[PLAYERS.YELLOW]
    };

    const clonedState = {
        bitboards: bitboardsCopy,
        currentPlayer: sourceGameState.currentPlayer,
        gameOver: sourceGameState.gameOver,
        winner: sourceGameState.winner,
        zobristHash: sourceGameState.zobristHash,
        hungryBB: hungryBBCopy // Include hungry state
    };
    return clonedState;
}

/**
 * Creates a deep copy of the current game state (including bitboards, Zobrist hash,
 * move history, clocks, hungry state etc.) and pushes it onto the `gameHistory` stack.
 * Depends on: gameState, gameHistory, PLAYERS (constants.js). Relies on global orangeTime, yellowTime.
 * Called by: performMove wrapper (main.js).
 */
function saveGameState() {
    // --- Validate gameState before saving ---
    if (!gameState || !gameState.bitboards || !gameState.moveHistory || !gameState.playerLastMoves ||
        typeof gameState.zobristHash !== 'bigint' || !gameState.hungryBB) {
        console.error("saveGameState Error: Current gameState is invalid or incomplete. Cannot save.");
        return;
    }

    // Deep copy moveHistory Map
    const moveHistoryCopy = new Map();
    gameState.moveHistory.forEach((value, key) => {
        moveHistoryCopy.set(key, { ...value });
    });

    // Deep copy playerLastMoves
    const playerLastMovesCopy = {
        [PLAYERS.ORANGE]: { ...(gameState.playerLastMoves[PLAYERS.ORANGE]) },
        [PLAYERS.YELLOW]: { ...(gameState.playerLastMoves[PLAYERS.YELLOW]) }
    };

    // Deep copy boardStateHistory
    const boardStateHistoryCopy = { ...gameState.boardStateHistory };

    // Copy hungry bitboards
    const hungryBBCopy = {
        [PLAYERS.ORANGE]: gameState.hungryBB[PLAYERS.ORANGE],
        [PLAYERS.YELLOW]: gameState.hungryBB[PLAYERS.YELLOW]
    };

    const stateToSave = {
        bitboards: [...gameState.bitboards],
        currentPlayer: gameState.currentPlayer,
        turnNumber: gameState.turnNumber,
        moveHistory: moveHistoryCopy,
        boardStateHistory: boardStateHistoryCopy,
        gameOver: gameState.gameOver,
        winner: gameState.winner,
        playerLastMoves: playerLastMovesCopy,
        zobristHash: gameState.zobristHash,
        hungryBB: hungryBBCopy, // Save hungry state
        orangeTime: orangeTime, // Save clock times
        yellowTime: yellowTime,
    };

    gameHistory.push(stateToSave);
}

/**
 * Restores the game state from a saved state object (using bitboards).
 * Updates the global `gameState` and related variables (clocks).
 * Does NOT update the UI directly - UI update should be called afterwards.
 * Depends on: gameState, PLAYERS, BB_IDX, INITIAL_TIME_SECONDS (constants.js), BB_EMPTY (bitboardUtils.js).
 * Modifies global: gameState, gameHistory, orangeTime, yellowTime.
 * @param {object} stateToLoad - The game state object retrieved from `gameHistory`.
 * @returns {boolean} True if loading was successful, false otherwise.
 */
function loadGameState(stateToLoad) {
    // --- Validate stateToLoad ---
    if (!stateToLoad || !Array.isArray(stateToLoad.bitboards) || stateToLoad.bitboards.length !== BB_IDX.COUNT ||
        !stateToLoad.moveHistory instanceof Map || typeof stateToLoad.zobristHash !== 'bigint' ||
        stateToLoad.playerLastMoves?.[PLAYERS.ORANGE] === undefined || stateToLoad.playerLastMoves?.[PLAYERS.YELLOW] === undefined ||
        typeof stateToLoad.orangeTime !== 'number' || typeof stateToLoad.yellowTime !== 'number' ||
        !stateToLoad.hungryBB) // Check hungryBB existence
    {
        console.error("loadGameState Error: Invalid or incomplete state object provided.", stateToLoad);
        return false; // Indicate failure
    }

    // --- Restore Core State ---
    gameState.bitboards = [...stateToLoad.bitboards];
    gameState.currentPlayer = stateToLoad.currentPlayer;
    gameState.turnNumber = stateToLoad.turnNumber;
    gameState.gameOver = stateToLoad.gameOver;
    gameState.winner = stateToLoad.winner;
    gameState.zobristHash = stateToLoad.zobristHash;

    // Restore moveHistory Map
    gameState.moveHistory = new Map();
    stateToLoad.moveHistory.forEach((value, key) => {
        gameState.moveHistory.set(key, { ...value });
    });

    // Restore boardStateHistory
    gameState.boardStateHistory = { ...stateToLoad.boardStateHistory };

    // Restore playerLastMoves
    gameState.playerLastMoves = {
        [PLAYERS.ORANGE]: { ...(stateToLoad.playerLastMoves[PLAYERS.ORANGE]) },
        [PLAYERS.YELLOW]: { ...(stateToLoad.playerLastMoves[PLAYERS.YELLOW]) }
    };

    // Restore Clock Times (update global variables)
    orangeTime = stateToLoad.orangeTime ?? INITIAL_TIME_SECONDS;
    yellowTime = stateToLoad.yellowTime ?? INITIAL_TIME_SECONDS;

    // Restore hungry state
    gameState.hungryBB = {
        [PLAYERS.ORANGE]: stateToLoad.hungryBB[PLAYERS.ORANGE] ?? BB_EMPTY,
        [PLAYERS.YELLOW]: stateToLoad.hungryBB[PLAYERS.YELLOW] ?? BB_EMPTY
    };

    return true; // Indicate success
}

// --- Export (if using modules) ---
// export { gameState, gameHistory, transpositionTable, initZobrist, ... };
