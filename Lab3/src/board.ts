/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import fs from 'node:fs';

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
        } finally {
            this.release();
        }
    }

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
    faceUp: boolean;
    controller: string | null;
    waiters: CardWaiter[];
}

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
        this.checkRep();
    }

    /**
     * Make a new board by parsing a file.
     *
     * @param filename path to game board file
     * @returns a new board with the size and cards from the file
     * @throws Error if the file cannot be read or is not a valid game board
     */
    public static async parseFromFile(filename: string): Promise<Board> {
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
        });
    }

    /**
     * Resets the board to its original configuration.
     * @param playerId player requesting the reset
     * @returns board state string after reset from playerId's perspective
     */
    public async reset(playerId: string): Promise<string> {
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
                        changed = true;
                    }
                }
                if (changed) {
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
                    seen.add(waiter.playerId);
                }
            }
        }
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
            }
        }
    }

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
            }
        }
        return lines.join('\n');
    }

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
}
