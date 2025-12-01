/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import fs from 'node:fs';

<<<<<<< HEAD
/** Regular expression that defines a legal player identifier. */
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_]+$/;

/** Regular expression that defines a legal card string. */
const CARD_PATTERN = /^[^\s\r\n]+$/;

/** Convenience for comparing board positions. */
interface Position {
    readonly row: number;
    readonly column: number;
}

/** Deferred promise used for wait queues. */
class Deferred<T> {
    public readonly promise: Promise<T>;
    public resolve!: (value: T | PromiseLike<T>) => void;
    public reject!: (reason?: unknown) => void;

    public constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }
}

/** Minimal async mutex to serialize critical sections. */
class AsyncMutex {
    private locked = false;
    private readonly waiters: Deferred<void>[] = [];

    public async runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
        await this.acquire();
        try {
            return await callback();
=======
/** Position on the game board. */
type Position = { readonly row: number; readonly column: number; };

/** Deferred promise helper. */
class Deferred<T> {
    public readonly promise: Promise<T>;
    public readonly resolve: (value: T) => void;
    public readonly reject: (reason: Error) => void;

    public constructor() {
        const { promise, resolve, reject } = Promise.withResolvers<T>();
        this.promise = promise;
        this.resolve = resolve;
        this.reject = reject as (reason: Error) => void;
    }
}

/** Minimal async mutex for protecting the board representation. */
class AsyncMutex {
    private locked = false;
    private readonly waiters: Array<() => void> = [];

    public async runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
        } finally {
            this.release();
        }
    }

<<<<<<< HEAD
    private async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        const deferred = new Deferred<void>();
        this.waiters.push(deferred);
        await deferred.promise;
    }

    private release(): void {
        if (this.waiters.length === 0) {
            this.locked = false;
            return;
        }
        const next = this.waiters.shift();
        if (next === undefined) {
            this.locked = false;
            return;
        }
        next.resolve();
    }
}

/** Represents a waiting player queued for a card. */
interface CardWaiter {
    readonly playerId: string;
    readonly deferred: Deferred<void>;
}

/** Internal state kept for each card slot on the board. */
interface CardSlot {
    value: string;
    present: boolean;
=======
    private acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return Promise.resolve();
        }
        const deferred = new Deferred<void>();
        this.waiters.push(deferred.resolve);
        return deferred.promise;
    }

    private release(): void {
        const next = this.waiters.shift();
        if (next !== undefined) {
            next();
        } else {
            this.locked = false;
        }
    }
}

interface CardWaiter {
    readonly playerId: string;
    readonly position: Position;
    readonly resolve: (value: string) => void;
    readonly reject: (reason: Error) => void;
}

interface CardState {
    label: string | null;
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
    faceUp: boolean;
    controller: string | null;
    waiters: CardWaiter[];
}

<<<<<<< HEAD
/** Internal tracking for each player. */
interface PlayerState {
    controlled: Position[];
    pendingFaceDown: Position[];
    pendingRemoval: Position[];
    awaitingSecond: boolean;
    firstSelection: Position | null;
}

/**
 * Mutable, concurrency-safe Memory Scramble board.
 *
 * The board stores the locations and strings of all cards, tracks which player (if any)
 * currently controls a face-up card, and exposes asynchronous operations that implement
 * the Memory Scramble rules from the problem set handout. Operations interleave safely,
 * waiting when required by the gameplay rules without busy-waiting. The board also
 * supports asynchronous change notification and asynchronous mapping of card strings.
 */
export class Board {

    private readonly rows: number;
    private readonly columns: number;
    private readonly slots: CardSlot[];
    private readonly initialCards: string[];
    private readonly players = new Map<string, PlayerState>();
    private readonly watchers: Deferred<void>[] = [];
    private readonly mutex = new AsyncMutex();
    private changeVersion = 0;

    // Abstraction function:
    //   rows and columns give the board dimensions; slots[row * columns + column]
    //   represents the card (or empty space) at that position. For each playerId in
    //   players, the associated PlayerState records controlled cards, pending clean-up,
    //   and whether the player is currently between the first and second flip.
  
    // Representation invariant:
    //   rows, columns > 0;
    //   slots.length === rows * columns;
    //   slot.present === false implies slot.faceUp === false and slot.controller === null and slot.waiters.length === 0;
    //   slot.controller !== null implies PLAYER_ID_PATTERN.test(slot.controller) and slot.faceUp === true;
    //   slot.waiters queue is FIFO with distinct playerIds;
    //   for each player state, controlled, pendingFaceDown, pendingRemoval, and firstSelection positions
    //   are within board bounds and refer to present cards when required;
    //   awaitingSecond is true iff controlled.length === 1 and firstSelection is that position;
    //   controlled positions match slots where controller === playerId.
  
    // Safety from rep exposure:
    //   All fields are private and never returned directly. Methods expose board state via
    //   freshly-generated strings. Positions stored in player state are new objects and never
    //   shared with clients.

    /**
     * Construct a new board with the provided card layout.
     * @param rows number of rows, must be > 0
     * @param columns number of columns, must be > 0
     * @param cards row-major list of card strings with length rows * columns
     */
    private constructor(rows: number, columns: number, cards: string[]) {
        assert(rows > 0 && columns > 0);
        assert(cards.length === rows * columns);
        this.rows = rows;
        this.columns = columns;
        this.slots = cards.map((value) => ({
            value,
            present: true,
            faceUp: false,
            controller: null,
            waiters: [],
        }));
        this.initialCards = cards.slice();
=======
type PendingState =
    | { readonly kind: 'match'; readonly cards: [Position, Position]; }
    | { readonly kind: 'mismatch'; readonly cards: Position[] };

interface PlayerState {
    readonly id: string;
    phase: 'needFirst' | 'needSecond';
    firstCard?: Position;
    pending: PendingState | null;
    waiting?: { readonly position: Position };
}

interface Watcher {
    readonly playerId: string;
    readonly resolve: (value: string) => void;
    readonly reject: (reason: Error) => void;
}

/**
 * Memory Scramble game board.
 *
 * Mutable and concurrency safe board that implements the rules of the
 * multiplayer Memory Scramble game. The board supports concurrent players,
 * change notifications, and card replacement operations.
 */
export class Board {

    private readonly height: number;
    private readonly width: number;
    private readonly cards: CardState[][];
    private readonly initialLabels: string[][];
    private readonly players = new Map<string, PlayerState>();
    private watchers: Watcher[] = [];
    private readonly mutex = new AsyncMutex();

    // Abstraction function:
    //   AF(height, width, cards, players) is a Memory Scramble board of the
    //   given dimensions whose mutable state is described by `cards`. Each
    //   element of `cards` represents one space on the grid, including whether
    //   a card is present, face up, and which player currently controls it.
    //   The `players` map records per-player state needed to enforce the rules
    //   (e.g. which phase of a turn they are in and cards pending removal).
    // Representation invariant:
    //   0 <= height, width
    //   |cards| == height and |cards[row]| == width for every row.
    //   If cards[row][column].label === null then the space is empty, the card
    //     is face down, has no controller, and has no waiters.
    //   If cards[row][column].faceUp === false then controller === null.
    //   Every controller in the grid corresponds to an entry in `players` that
    //     is in phase 'needSecond' or has a pending match containing that card.
    //   No player appears more than once in a card's waiter list and waiters
    //     only reference existing players.
    //   For player state: if phase === 'needSecond' then firstCard is defined
    //     and references a card controlled by that player; if phase ===
    //     'needFirst' then firstCard is undefined. For pending matches or
    //     mismatches, referenced cards exist on the board when applicable.
    // Safety from rep exposure:
    //   All mutable state is private. Returned board-state strings are fresh
    //   immutable copies. No method exposes direct references to the internal
    //   representation.

    private constructor(height: number, width: number, labels: string[][]) {
    this.height = height;
    this.width = width;
    this.initialLabels = labels.map((row) => row.slice());
    this.cards = [];
        for (let row = 0; row < height; row += 1) {
            const cardRow: CardState[] = [];
            for (let column = 0; column < width; column += 1) {
                const rowLabels = labels[row];
                if (rowLabels === undefined) {
                    throw new Error(`missing label row ${row}`);
                }
                const label = rowLabels[column];
                if (label === undefined) {
                    throw new Error(`missing label at (${row},${column})`);
                }
                cardRow.push({
                    label,
                    faceUp: false,
                    controller: null,
                    waiters: [],
                });
            }
            this.cards.push(cardRow);
        }
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
        this.checkRep();
    }

    /**
     * Make a new board by parsing a file.
     *
<<<<<<< HEAD
=======
     * PS4 instructions: the specification of this method may not be changed.
     *
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
     * @param filename path to game board file
     * @returns a new board with the size and cards from the file
     * @throws Error if the file cannot be read or is not a valid game board
     */
    public static async parseFromFile(filename: string): Promise<Board> {
<<<<<<< HEAD
        let data: string;
        try {
            data = await fs.promises.readFile(filename, { encoding: 'utf-8' });
        } catch (err) {
            throw new Error(`unable to read board file ${filename}: ${String(err)}`);
        }

        const lines = data.replace(/\r/g, '').split('\n');
        const headerLine = lines.shift();
        if (headerLine === undefined || headerLine.trim().length === 0) {
            throw new Error('board file missing header line');
        }

        const headerMatch = /^([0-9]+)x([0-9]+)$/.exec(headerLine.trim());
        if (!headerMatch) {
            throw new Error('board file header must be ROWxCOLUMN with positive integers');
        }
        const rows = Number(headerMatch[1]);
        const columns = Number(headerMatch[2]);
        if (rows <= 0 || columns <= 0) {
            throw new Error('board dimensions must be positive');
        }

        const expectedCards = rows * columns;
        const cards: string[] = [];
        for (const raw of lines) {
            if (raw.trim().length === 0) {
                continue;
            }
            if (!CARD_PATTERN.test(raw)) {
                throw new Error(`invalid card string: ${raw}`);
            }
            cards.push(raw);
        }
        if (cards.length !== expectedCards) {
            throw new Error(`expected ${expectedCards} cards but found ${cards.length}`);
        }

        return new Board(rows, columns, cards);
    }

    /**
     * Look at the board from the perspective of {@link playerId}.
     * @param playerId id of observing player
     * @returns snapshot of the board using the problem-set board state grammar
     */
    public async look(playerId: string): Promise<string> {
        this.requireValidPlayerId(playerId);
        return this.mutex.runExclusive(() => {
            this.ensurePlayerState(playerId);
            this.checkRep();
            return this.formatBoard(playerId);
=======
        const raw = await fs.promises.readFile(filename, { encoding: 'utf8' }).catch((err: unknown) => {
            throw new Error(`unable to read board file: ${err}`);
        });
        const cleaned = raw.replace(/\r/g, '').trim();
        const lines = cleaned.split('\n');
        if (lines.length === 0) {
            throw new Error('board file must specify dimensions');
        }
        const sizeLine = lines.shift()!;
        const sizeMatch = sizeLine.match(/^(\d+)x(\d+)$/);
        if (!sizeMatch) {
            throw new Error(`invalid board dimensions: ${sizeLine}`);
        }
        const height = parseInt(sizeMatch[1]!, 10);
        const width = parseInt(sizeMatch[2]!, 10);
        if (height <= 0 || width <= 0) {
            throw new Error('board dimensions must be positive');
        }
        const expectedCards = height * width;
        if (lines.length !== expectedCards) {
            throw new Error(`expected ${expectedCards} cards but found ${lines.length}`);
        }
        const cards: string[][] = [];
        for (let row = 0; row < height; row += 1) {
            const rowValues: string[] = [];
            for (let column = 0; column < width; column += 1) {
                const value = lines[row * width + column]!;
                if (!/^\S+$/.test(value)) {
                    throw new Error(`invalid card value '${value}' at (${row},${column})`);
                }
                rowValues.push(value);
            }
            cards.push(rowValues);
        }
        return new Board(height, width, cards);
    }

    /**
     * Observes the current board state from the perspective of {@code playerId}.
     *
     * @param playerId player identifier
     * @returns board state string
     */
    public async look(playerId: string): Promise<string> {
        this.validatePlayerId(playerId);
        return this.mutex.runExclusive(() => {
            this.ensurePlayer(playerId);
            this.checkRep();
            return this.boardStateFor(playerId);
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
        });
    }

    /**
     * Resets the board to its original configuration.
<<<<<<< HEAD
=======
     *
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
     * @param playerId player requesting the reset
     * @returns board state string after reset from playerId's perspective
     */
    public async reset(playerId: string): Promise<string> {
<<<<<<< HEAD
        this.requireValidPlayerId(playerId);
        await this.mutex.runExclusive(() => {
            this.ensurePlayerState(playerId);
            for (let index = 0; index < this.slots.length; index += 1) {
                const slot = this.slots[index]!;
                slot.value = this.initialCards[index]!;
                slot.present = true;
                slot.faceUp = false;
                slot.controller = null;
                this.clearWaiters(slot);
            }
            for (const state of this.players.values()) {
                state.controlled = [];
                state.pendingFaceDown = [];
                state.pendingRemoval = [];
                state.awaitingSecond = false;
                state.firstSelection = null;
            }
            this.notifyChange();
            this.checkRep();
        });
        return this.look(playerId);
    }

    /**
     * Flip a card at {@link position} on behalf of {@link playerId}.
     * Implements both first and second card behaviour per the rules.
     * @param playerId flipping player
     * @param row board row
     * @param column board column
     * @returns board state after the flip
     */
    public async flip(playerId: string, row: number, column: number): Promise<string> {
        this.requireValidPlayerId(playerId);
        this.requireInBounds(row, column);
        const position: Position = { row, column };
        const state = await this.mutex.runExclusive(() => this.ensurePlayerState(playerId));

        if (!state.awaitingSecond) {
            await this.prepareForNextMove(playerId, state);
            await this.takeFirstCard(playerId, state, position);
        } else {
            await this.takeSecondCard(playerId, state, position);
        }

        return this.look(playerId);
    }

    /**
     * Apply {@link f} to every card on the board without blocking other operations.
     * @param playerId player requesting the map
     * @param f asynchronous transformer from old card string to replacement string
     * @returns board state after replacements are applied
     */
    public async map(playerId: string, f: (card: string) => Promise<string>): Promise<string> {
        this.requireValidPlayerId(playerId);
        const valueMap = await this.mutex.runExclusive(() => {
            this.ensurePlayerState(playerId);
            const values = new Map<string, number[]>();
            this.slots.forEach((slot, index) => {
                if (!slot.present) {
                    return;
                }
                const bucket = values.get(slot.value);
                if (bucket === undefined) {
                    values.set(slot.value, [index]);
                } else {
                    bucket.push(index);
                }
            });
            this.checkRep();
            return values;
        });

        for (const [value, indices] of valueMap.entries()) {
            const replacement = await f(value);
            this.requireValidCard(replacement);
            await this.mutex.runExclusive(() => {
                let changed = false;
                for (const index of indices) {
                    const slot = this.slots[index];
                    if (slot === undefined || !slot.present) {
                        continue;
                    }
                    if (slot.value === value && slot.value !== replacement) {
                        slot.value = replacement;
=======
        this.validatePlayerId(playerId);
        const postActions: Array<() => void> = [];
        let state: string | undefined;
        await this.mutex.runExclusive(() => {
            const reason = new Error('game reset');
            for (let row = 0; row < this.height; row += 1) {
                for (let column = 0; column < this.width; column += 1) {
                    this.rejectAllWaiters(row, column, postActions, reason);
                    const card = this.cardAt(row, column);
                    const initialRow = this.initialLabels[row];
                    if (initialRow === undefined) {
                        throw new Error(`missing initial label row ${row}`);
                    }
                    const initialLabel = initialRow[column];
                    if (initialLabel === undefined) {
                        throw new Error(`missing initial label at (${row},${column})`);
                    }
                    card.label = initialLabel;
                    card.faceUp = false;
                    card.controller = null;
                    card.waiters = [];
                }
            }
            for (const player of this.players.values()) {
                player.phase = 'needFirst';
                player.firstCard = undefined;
                player.pending = null;
                player.waiting = undefined;
            }
            this.ensurePlayer(playerId);
            this.notifyChange(postActions);
            this.checkRep();
            state = this.boardStateFor(playerId);
        });
        for (const action of postActions) {
            action();
        }
        if (state === undefined) {
            throw new Error('reset must produce a board state');
        }
        return state;
    }

    /**
     * Executes a flip operation as defined by the Memory Scramble rules.
     *
     * @param playerId player performing the flip
     * @param row row index, 0-based from the top
     * @param column column index, 0-based from the left
     * @returns board state string after the flip
     */
    public async flip(playerId: string, row: number, column: number): Promise<string> {
        this.validatePlayerId(playerId);
        this.validateCoordinates(row, column);
        const position: Position = { row, column };
        const postActions: Array<() => void> = [];
        let waitPromise: Promise<string> | undefined;
        let result: string | undefined;
        let failure: unknown;

        try {
            await this.mutex.runExclusive(() => {
                const player = this.ensurePlayer(playerId);
                if (player.phase === 'needFirst') {
                    this.settlePreviousTurn(player, postActions);
                    const card = this.cardAt(row, column);
                    if (card.label === null) {
                        throw new Error('no card at that location');
                    }
                    if (card.controller !== null && card.controller !== playerId) {
                        assert(player.waiting === undefined, 'player already waiting for a card');
                        const deferred = new Deferred<string>();
                        card.waiters.push({
                            playerId,
                            position,
                            resolve: deferred.resolve,
                            reject: deferred.reject,
                        });
                        player.waiting = { position };
                        waitPromise = deferred.promise;
                    } else {
                        const wasFaceDown = !card.faceUp;
                        card.faceUp = true;
                        card.controller = playerId;
                        player.phase = 'needSecond';
                        player.firstCard = position;
                        player.pending = null;
                        player.waiting = undefined;
                        if (wasFaceDown || card.controller === playerId) {
                            this.notifyChange(postActions);
                        }
                        result = this.boardStateFor(playerId);
                    }
                } else {
                    const first = player.firstCard;
                    if (first === undefined) {
                        throw new Error('player must have a first card');
                    }
                    const firstCard = this.cardAt(first.row, first.column);
                    if (firstCard.controller !== playerId) {
                        player.phase = 'needFirst';
                        player.firstCard = undefined;
                        player.pending = null;
                        throw new Error('first card no longer controlled');
                    }
                    if (first.row === row && first.column === column) {
                        firstCard.controller = null;
                        player.phase = 'needFirst';
                        player.firstCard = undefined;
                        player.pending = { kind: 'mismatch', cards: [ first ] };
                        this.notifyChange(postActions);
                        this.promoteFirstWaiter(first.row, first.column, postActions);
                        throw new Error('cannot flip the same card twice');
                    }
                    const secondCard = this.cardAt(row, column);
                    if (secondCard.label === null) {
                        firstCard.controller = null;
                        player.phase = 'needFirst';
                        player.firstCard = undefined;
                        player.pending = { kind: 'mismatch', cards: [ first ] };
                        this.notifyChange(postActions);
                        this.promoteFirstWaiter(first.row, first.column, postActions);
                        throw new Error('no card at that location');
                    }
                    if (secondCard.controller !== null) {
                        firstCard.controller = null;
                        player.phase = 'needFirst';
                        player.firstCard = undefined;
                        player.pending = { kind: 'mismatch', cards: [ first ] };
                        this.notifyChange(postActions);
                        this.promoteFirstWaiter(first.row, first.column, postActions);
                        throw new Error('card already controlled');
                    }
                    const wasFaceDown = !secondCard.faceUp;
                    secondCard.faceUp = true;
                    secondCard.controller = playerId;
                    if (wasFaceDown) {
                        this.notifyChange(postActions);
                    }
                    if (firstCard.label === secondCard.label) {
                        player.pending = { kind: 'match', cards: [ first, position ] };
                        player.phase = 'needFirst';
                        player.firstCard = undefined;
                        this.notifyChange(postActions);
                        result = this.boardStateFor(playerId);
                    } else {
                        secondCard.controller = null;
                        firstCard.controller = null;
                        player.pending = { kind: 'mismatch', cards: [ first, position ] };
                        player.phase = 'needFirst';
                        player.firstCard = undefined;
                        this.notifyChange(postActions);
                        this.promoteFirstWaiter(first.row, first.column, postActions);
                        this.promoteFirstWaiter(row, column, postActions);
                        result = this.boardStateFor(playerId);
                    }
                }
                this.checkRep();
            });
        } catch (err) {
            failure = err;
        }

        for (const action of postActions) {
            action();
        }

        if (waitPromise !== undefined) {
            if (failure !== undefined) {
                throw failure;
            }
            return waitPromise;
        }
        if (failure !== undefined) {
            throw failure;
        }
        if (result === undefined) {
            throw new Error('flip must produce a board state');
        }
        return result;
    }

    /**
     * Applies {@code f} to every card string, retaining all other game state.
     *
     * @param playerId applying player
     * @param f transformer function
     * @returns board state string after replacement
     */
    public async map(playerId: string, f: (card: string) => Promise<string>): Promise<string> {
        this.validatePlayerId(playerId);

        const labelPositions = new Map<string, Position[]>();
        await this.mutex.runExclusive(() => {
            this.ensurePlayer(playerId);
            for (let row = 0; row < this.height; row += 1) {
                for (let column = 0; column < this.width; column += 1) {
                    const card = this.cardAt(row, column);
                    if (card.label !== null) {
                        const list = labelPositions.get(card.label) ?? [];
                        list.push({ row, column });
                        labelPositions.set(card.label, list);
                    }
                }
            }
            this.checkRep();
        });

        for (const [label, positions] of labelPositions.entries()) {
            const replacement = await f(label);
            if (!/^\S+$/.test(replacement)) {
                throw new Error(`replacement '${replacement}' is not a legal card`);
            }
            const postActions: Array<() => void> = [];
            await this.mutex.runExclusive(() => {
                let changed = false;
                for (const pos of positions) {
                    const card = this.cardAt(pos.row, pos.column);
                    if (card.label === label && card.label !== replacement) {
                        card.label = replacement;
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
                        changed = true;
                    }
                }
                if (changed) {
<<<<<<< HEAD
                    this.notifyChange();
                }
                this.checkRep();
            });
        }

        return this.look(playerId);
    }

    /**
     * Wait for the next visible change to the board and then report the new state.
     * @param playerId watching player
     * @returns board state after the next change completes
     */
    public async watch(playerId: string): Promise<string> {
        this.requireValidPlayerId(playerId);
        const deferred = new Deferred<void>();
        const startVersion = this.changeVersion;
        await this.mutex.runExclusive(() => {
            this.ensurePlayerState(playerId);
            if (this.changeVersion !== startVersion) {
                deferred.resolve();
            } else {
                this.watchers.push(deferred);
            }
            this.checkRep();
        });
        await deferred.promise;
        return this.look(playerId);
    }

    /**
     * Human-readable snapshot of the board used for debugging.
     * @returns formatted board state with no player perspective
     */
    public toString(): string {
        return `Board ${this.rows}x${this.columns}`;
    }

    /** Verify representation invariant. */
    private checkRep(): void {
        assert(this.rows > 0 && this.columns > 0);
        assert.strictEqual(this.slots.length, this.rows * this.columns);
        for (let index = 0; index < this.slots.length; index += 1) {
            const slot = this.slots[index]!;
            if (!slot.present) {
                assert.strictEqual(slot.faceUp, false);
                assert.strictEqual(slot.controller, null);
                assert.strictEqual(slot.waiters.length, 0);
            } else {
                assert(CARD_PATTERN.test(slot.value));
                if (slot.controller !== null) {
                    assert(PLAYER_ID_PATTERN.test(slot.controller));
                    assert.strictEqual(slot.faceUp, true);
                }
                const seen = new Set<string>();
                for (const waiter of slot.waiters) {
                    assert(PLAYER_ID_PATTERN.test(waiter.playerId));
                    assert(!seen.has(waiter.playerId));
=======
                    this.notifyChange(postActions);
                }
                this.checkRep();
            });
            for (const action of postActions) {
                action();
            }
        }

        return this.mutex.runExclusive(() => {
            this.checkRep();
            return this.boardStateFor(playerId);
        });
    }

    /**
     * Waits for the next observable board change.
     *
     * @param playerId observing player
     * @returns board state string after the next change
     */
    public async watch(playerId: string): Promise<string> {
        this.validatePlayerId(playerId);
        const deferred = new Deferred<string>();
        await this.mutex.runExclusive(() => {
            this.ensurePlayer(playerId);
            this.watchers.push({ playerId, resolve: deferred.resolve, reject: deferred.reject });
            this.checkRep();
        });
        return deferred.promise;
    }

    /** Checks the representation invariant. */
    private checkRep(): void {
        assert(this.cards.length === this.height, 'row count mismatch');
        for (const row of this.cards) {
            assert(row.length === this.width, 'column count mismatch');
        }
        for (let row = 0; row < this.height; row += 1) {
            for (let column = 0; column < this.width; column += 1) {
                const card = this.cardAt(row, column);
                if (card.label === null) {
                    assert(!card.faceUp, 'removed card must be face down');
                    assert(card.controller === null, 'removed card cannot be controlled');
                    assert(card.waiters.length === 0, 'removed card cannot have waiters');
                }
                if (!card.faceUp) {
                    assert(card.controller === null, 'face-down card cannot be controlled');
                }
                if (card.controller !== null) {
                    assert(this.players.has(card.controller), 'controller must be a known player');
                }
                const seen = new Set<string>();
                for (const waiter of card.waiters) {
                    assert(this.players.has(waiter.playerId), 'waiter must be a known player');
                    assert(!seen.has(waiter.playerId), 'duplicate waiter for card');
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
                    seen.add(waiter.playerId);
                }
            }
        }
<<<<<<< HEAD
        for (const [playerId, state] of this.players.entries()) {
            assert(PLAYER_ID_PATTERN.test(playerId));
            const controlledKeys = new Set<string>();
            for (const pos of state.controlled) {
                this.assertPosition(pos);
                const slot = this.getSlot(pos);
                assert(slot.present);
                assert.strictEqual(slot.controller, playerId);
                const key = this.positionKey(pos);
                assert(!controlledKeys.has(key));
                controlledKeys.add(key);
            }
            state.pendingFaceDown.forEach((pos) => this.assertPosition(pos));
            state.pendingRemoval.forEach((pos) => this.assertPosition(pos));
            if (state.awaitingSecond) {
                assert.strictEqual(state.controlled.length, 1);
                assert(state.firstSelection !== null);
                assert(this.samePosition(state.controlled[0]!, state.firstSelection!));
            } else {
                assert(state.firstSelection === null);
=======
        for (const player of this.players.values()) {
            if (player.phase === 'needSecond') {
                if (player.firstCard === undefined) {
                    throw new Error('player in needSecond must have first card');
                }
                const card = this.cardAt(player.firstCard.row, player.firstCard.column);
                assert(card.controller === player.id, 'player must control their first card');
            } else {
                assert(player.firstCard === undefined, 'player in needFirst cannot have first card');
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
            }
        }
    }

<<<<<<< HEAD
    private async prepareForNextMove(playerId: string, state: PlayerState): Promise<void> {
        if (state.pendingFaceDown.length === 0 && state.pendingRemoval.length === 0) {
            return;
        }
        await this.mutex.runExclusive(() => {
            for (const pos of state.pendingRemoval) {
                const slot = this.getSlot(pos);
                if (!slot.present) {
                    continue;
                }
                if (slot.controller === playerId) {
                    slot.present = false;
                    slot.faceUp = false;
                    slot.controller = null;
                    this.clearWaiters(slot);
                    this.notifyChange();
                }
            }
            state.pendingRemoval = [];
            state.controlled = state.controlled.filter((pos) => {
                const slot = this.getSlot(pos);
                return slot.present && slot.controller === playerId;
            });

            for (const pos of state.pendingFaceDown) {
                const slot = this.getSlot(pos);
                if (!slot.present) {
                    continue;
                }
                if (slot.controller === null && slot.faceUp) {
                    slot.faceUp = false;
                    this.notifyChange();
                }
                this.wakeNextWaiter(slot);
            }
            state.pendingFaceDown = [];
            this.checkRep();
        });
    }

    private async takeFirstCard(playerId: string, state: PlayerState, position: Position): Promise<void> {
        while (true) {
            const wait = await this.mutex.runExclusive(() => {
                const slot = this.getSlot(position);
                if (!slot.present) {
                    throw new Error('no card at that location');
                }
                if (slot.controller === playerId) {
                    state.controlled = [this.clonePosition(position)];
                    state.firstSelection = this.clonePosition(position);
                    state.awaitingSecond = true;
                    this.checkRep();
                    return null;
                }
                if (slot.controller !== null) {
                    return this.enqueueWaiter(slot, playerId);
                }
                if (slot.waiters.length > 0) {
                    const head = slot.waiters[0];
                    if (head !== undefined && head.playerId === playerId) {
                        slot.waiters.shift();
                    } else {
                        return this.enqueueWaiter(slot, playerId);
                    }
                }
                slot.controller = playerId;
                if (!slot.faceUp) {
                    slot.faceUp = true;
                    this.notifyChange();
                }
                state.controlled = [this.clonePosition(position)];
                state.firstSelection = this.clonePosition(position);
                state.awaitingSecond = true;
                state.pendingFaceDown = [];
                state.pendingRemoval = [];
                this.checkRep();
                return null;
            });
            if (wait === null) {
                break;
            }
            await wait.promise;
        }
    }

    private async takeSecondCard(playerId: string, state: PlayerState, position: Position): Promise<void> {
        const firstPos = state.firstSelection;
        if (firstPos === null) {
            throw new Error('no first card to match');
        }

        while (true) {
            const wait = await this.mutex.runExclusive(() => {
                const firstSlot = this.getSlot(firstPos);
                if (!firstSlot.present || firstSlot.controller !== playerId) {
                    state.awaitingSecond = false;
                    state.controlled = [];
                    state.firstSelection = null;
                    throw new Error('lost control of first card');
                }
                const secondSlot = this.getSlot(position);
                if (!secondSlot.present) {
                    this.releaseControl(firstSlot);
                    state.pendingFaceDown = [this.clonePosition(firstPos)];
                    state.controlled = [];
                    state.awaitingSecond = false;
                    state.firstSelection = null;
                    this.checkRep();
                    throw new Error('no card at that location');
                }
                if (secondSlot.controller !== null) {
                    this.releaseControl(firstSlot);
                    state.pendingFaceDown = [this.clonePosition(firstPos)];
                    state.controlled = [];
                    state.awaitingSecond = false;
                    state.firstSelection = null;
                    this.checkRep();
                    throw new Error('card already controlled');
                }
                if (secondSlot.waiters.length > 0) {
                    const head = secondSlot.waiters[0];
                    if (head !== undefined && head.playerId === playerId) {
                        secondSlot.waiters.shift();
                    } else {
                        return this.enqueueWaiter(secondSlot, playerId);
                    }
                }
                if (!secondSlot.faceUp) {
                    secondSlot.faceUp = true;
                    this.notifyChange();
                }
                const firstValue = firstSlot.value;
                const secondValue = secondSlot.value;
                if (secondValue === firstValue) {
                    secondSlot.controller = playerId;
                    state.pendingRemoval = [this.clonePosition(firstPos), this.clonePosition(position)];
                    state.controlled = [this.clonePosition(firstPos), this.clonePosition(position)];
                    state.awaitingSecond = false;
                    state.firstSelection = null;
                } else {
                    this.releaseControl(firstSlot);
                    secondSlot.controller = null;
                    state.pendingFaceDown = [this.clonePosition(firstPos), this.clonePosition(position)];
                    state.controlled = [];
                    state.awaitingSecond = false;
                    state.firstSelection = null;
                    this.wakeNextWaiter(secondSlot);
                }
                this.checkRep();
                return null;
            });
            if (wait === null) {
                break;
            }
            await wait.promise;
        }
    }

    private enqueueWaiter(slot: CardSlot, playerId: string): Deferred<void> {
        const existing = slot.waiters.find((waiter) => waiter.playerId === playerId);
        if (existing !== undefined) {
            return existing.deferred;
        }
        const deferred = new Deferred<void>();
        slot.waiters.push({ playerId, deferred });
        return deferred;
    }

    private releaseControl(slot: CardSlot): void {
        if (slot.controller !== null) {
            slot.controller = null;
            this.wakeNextWaiter(slot);
        }
    }

    private wakeNextWaiter(slot: CardSlot): void {
        if (slot.waiters.length === 0) {
            return;
        }
        const waiter = slot.waiters.shift();
        waiter?.deferred.resolve();
    }

    private clearWaiters(slot: CardSlot): void {
        while (slot.waiters.length > 0) {
            const waiter = slot.waiters.shift();
            waiter?.deferred.resolve();
        }
    }

    private formatBoard(playerId: string): string {
        const lines: string[] = [`${this.rows}x${this.columns}`];
        for (let row = 0; row < this.rows; row += 1) {
            for (let column = 0; column < this.columns; column += 1) {
                const slot = this.getSlot({ row, column });
                if (!slot.present) {
                    lines.push('none');
                } else if (!slot.faceUp) {
                    lines.push('down');
                } else if (slot.controller === playerId) {
                    lines.push(`my ${slot.value}`);
                } else {
                    lines.push(`up ${slot.value}`);
                }
=======
    private cardAt(row: number, column: number): CardState {
        const rowData = this.cards[row];
        if (rowData === undefined) {
            throw new Error(`row out of bounds: ${row}`);
        }
        const card = rowData[column];
        if (card === undefined) {
            throw new Error(`column out of bounds: ${column}`);
        }
        return card;
    }

    private boardStateFor(playerId: string): string {
        const lines: string[] = [`${this.height}x${this.width}`];
        for (let row = 0; row < this.height; row += 1) {
            for (let column = 0; column < this.width; column += 1) {
                lines.push(this.describeSpot(playerId, row, column));
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
            }
        }
        return lines.join('\n');
    }

<<<<<<< HEAD
    private ensurePlayerState(playerId: string): PlayerState {
        let state = this.players.get(playerId);
        if (state === undefined) {
            state = {
                controlled: [],
                pendingFaceDown: [],
                pendingRemoval: [],
                awaitingSecond: false,
                firstSelection: null,
            };
            this.players.set(playerId, state);
        }
        return state;
    }

    private getSlot(position: Position): CardSlot {
        const index = this.indexFor(position.row, position.column);
        const slot = this.slots[index];
        if (slot === undefined) {
            throw new Error('invalid board position');
        }
        return slot;
    }

    private indexFor(row: number, column: number): number {
        return row * this.columns + column;
    }

    private notifyChange(): void {
        this.changeVersion += 1;
        if (this.watchers.length === 0) {
            return;
        }
        const listeners = this.watchers.splice(0, this.watchers.length);
        for (const listener of listeners) {
            listener.resolve();
        }
    }

    private requireValidPlayerId(playerId: string): void {
        if (!PLAYER_ID_PATTERN.test(playerId)) {
            throw new Error('invalid player id');
        }
    }

    private requireValidCard(card: string): void {
        if (!CARD_PATTERN.test(card)) {
            throw new Error('invalid card string');
        }
    }

    private requireInBounds(row: number, column: number): void {
        if (!Number.isInteger(row) || !Number.isInteger(column)) {
            throw new Error('row and column must be integers');
        }
        if (row < 0 || row >= this.rows || column < 0 || column >= this.columns) {
            throw new Error('coordinates out of bounds');
        }
    }

    private clonePosition(position: Position): Position {
        return { row: position.row, column: position.column };
    }

    private samePosition(a: Position, b: Position): boolean {
        return a.row === b.row && a.column === b.column;
    }

    private assertPosition(position: Position): void {
        assert(Number.isInteger(position.row));
        assert(Number.isInteger(position.column));
        assert(position.row >= 0 && position.row < this.rows);
        assert(position.column >= 0 && position.column < this.columns);
    }

    private positionKey(position: Position): string {
        return `${position.row},${position.column}`;
    }
=======
    private describeSpot(playerId: string, row: number, column: number): string {
        const card = this.cardAt(row, column);
        if (card.label === null) {
            return 'none';
        }
        if (!card.faceUp) {
            return 'down';
        }
        if (card.controller === playerId) {
            return `my ${card.label}`;
        }
        return `up ${card.label}`;
    }

    private ensurePlayer(playerId: string): PlayerState {
        let player = this.players.get(playerId);
        if (player === undefined) {
            player = { id: playerId, phase: 'needFirst', pending: null };
            this.players.set(playerId, player);
        }
        return player;
    }

    private notifyChange(postActions: Array<() => void>): void {
        if (this.watchers.length === 0) {
            return;
        }
        const watchers = this.watchers;
        this.watchers = [];
        const snapshots = watchers.map((watcher) => ({
            state: this.boardStateFor(watcher.playerId),
            resolve: watcher.resolve,
        }));
        postActions.push(() => {
            for (const { state, resolve } of snapshots) {
                resolve(state);
            }
        });
    }

    private rejectAllWaiters(row: number, column: number, postActions: Array<() => void>, reason: Error): void {
        const card = this.cardAt(row, column);
        if (card.waiters.length === 0) {
            return;
        }
        const waiters = card.waiters;
        card.waiters = [];
        postActions.push(() => {
            for (const waiter of waiters) {
                waiter.reject(reason);
            }
        });
    }

    private promoteFirstWaiter(row: number, column: number, postActions: Array<() => void>): void {
        const card = this.cardAt(row, column);
        while (card.waiters.length > 0) {
            const waiter = card.waiters.shift()!;
            const player = this.players.get(waiter.playerId);
            if (player === undefined) {
                postActions.push(() => waiter.reject(new Error('player left the game')));
                continue;
            }
            player.waiting = undefined;
            if (card.label === null) {
                postActions.push(() => waiter.reject(new Error('card removed')));
                continue;
            }
            if (player.phase !== 'needFirst') {
                postActions.push(() => waiter.reject(new Error('player request superseded')));
                continue;
            }
            card.faceUp = true;
            card.controller = player.id;
            player.phase = 'needSecond';
            player.firstCard = { row, column };
            player.pending = null;
            this.notifyChange(postActions);
            const state = this.boardStateFor(player.id);
            postActions.push(() => waiter.resolve(state));
            break;
        }
    }

    private settlePreviousTurn(player: PlayerState, postActions: Array<() => void>): void {
        if (player.pending === null) {
            return;
        }
        if (player.pending.kind === 'match') {
            for (const cardPos of player.pending.cards) {
                const card = this.cardAt(cardPos.row, cardPos.column);
                if (card.label !== null) {
                    card.label = null;
                    card.faceUp = false;
                    card.controller = null;
                    this.rejectAllWaiters(cardPos.row, cardPos.column, postActions, new Error('card removed'));
                    this.notifyChange(postActions);
                }
            }
        } else {
            for (const cardPos of player.pending.cards) {
                const card = this.cardAt(cardPos.row, cardPos.column);
                if (card.label !== null && card.faceUp && card.controller === null) {
                    card.faceUp = false;
                    this.notifyChange(postActions);
                }
                this.promoteFirstWaiter(cardPos.row, cardPos.column, postActions);
            }
        }
        player.pending = null;
    }

    private validatePlayerId(playerId: string): void {
        if (!/^[A-Za-z0-9_]+$/.test(playerId)) {
            throw new Error(`invalid player id: ${playerId}`);
        }
    }

    private validateCoordinates(row: number, column: number): void {
        if (!Number.isInteger(row) || !Number.isInteger(column)) {
            throw new Error('row and column must be integers');
        }
        if (row < 0 || row >= this.height || column < 0 || column >= this.width) {
            throw new Error(`coordinates out of range: (${row},${column})`);
        }
    }
>>>>>>> c61c15e5a9169f1f5acaf72efb9262e67c6e4ac9
}
