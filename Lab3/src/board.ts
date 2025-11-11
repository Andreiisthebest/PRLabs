/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import fs from 'node:fs';

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
        } finally {
            this.release();
        }
    }

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
    faceUp: boolean;
    controller: string | null;
    waiters: CardWaiter[];
}

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
        this.checkRep();
    }

    /**
     * Make a new board by parsing a file.
     *
     * PS4 instructions: the specification of this method may not be changed.
     *
     * @param filename path to game board file
     * @returns a new board with the size and cards from the file
     * @throws Error if the file cannot be read or is not a valid game board
     */
    public static async parseFromFile(filename: string): Promise<Board> {
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
        });
    }

    /**
     * Resets the board to its original configuration.
     *
     * @param playerId player requesting the reset
     * @returns board state string after reset from playerId's perspective
     */
    public async reset(playerId: string): Promise<string> {
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
                        changed = true;
                    }
                }
                if (changed) {
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
                    seen.add(waiter.playerId);
                }
            }
        }
        for (const player of this.players.values()) {
            if (player.phase === 'needSecond') {
                if (player.firstCard === undefined) {
                    throw new Error('player in needSecond must have first card');
                }
                const card = this.cardAt(player.firstCard.row, player.firstCard.column);
                assert(card.controller === player.id, 'player must control their first card');
            } else {
                assert(player.firstCard === undefined, 'player in needFirst cannot have first card');
            }
        }
    }

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
            }
        }
        return lines.join('\n');
    }

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
}
