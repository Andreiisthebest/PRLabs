/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { Board } from '../src/board.js';

/** Helper to construct a fresh board for each test. */
async function makeBoard(): Promise<Board> {
    return Board.parseFromFile('boards/ab.txt');
}

interface BoardSnapshot {
    readonly height: number;
    readonly width: number;
    readonly cells: string[][];
}

function parseBoardState(state: string): BoardSnapshot {
    const lines = state.split('\n');
    const header = lines.shift();
    if (header === undefined) {
        throw new Error('missing board header');
    }
    const match = header.match(/^(\d+)x(\d+)$/);
    if (!match) {
        throw new Error(`invalid board header '${header}'`);
    }
    const height = parseInt(match[1]!, 10);
    const width = parseInt(match[2]!, 10);
    const cells: string[][] = [];
    for (let row = 0; row < height; row += 1) {
        const rowCells: string[] = [];
        for (let column = 0; column < width; column += 1) {
            const value = lines[row * width + column];
            if (value === undefined) {
                throw new Error('board state truncated');
            }
            rowCells.push(value);
        }
        cells.push(rowCells);
    }
    return { height, width, cells };
}

function renderBoardState(state: string): string {
    const parsed = parseBoardState(state);
    const longest = parsed.cells.reduce((max, row) => {
        return Math.max(max, ...row.map((value) => value.length));
    }, 0);
    const pad = (value: string) => value.padEnd(longest, ' ');
    const rows = parsed.cells.map((row) => row.map(pad).join(' | '));
    return [
        `${parsed.height}x${parsed.width}`,
        ...rows,
    ].join('\n');
}

function logBoardState(label: string, state: string): void {
    // Always log so the full board is easy to inspect in the terminal output.
    console.log(`\n${label}:\n${renderBoardState(state)}`);
}

function cell(state: string, row: number, column: number): string {
    const parsed = parseBoardState(state);
    const rowCells = parsed.cells[row];
    if (rowCells === undefined) {
        throw new Error(`row ${row} missing in board state`);
    }
    const value = rowCells[column];
    if (value === undefined) {
        throw new Error(`column ${column} missing in board state`);
    }
    return value;
}

function expectCell(state: string, row: number, column: number, expected: string): void {
    const actual = cell(state, row, column);
    assert.strictEqual(
        actual,
        expected,
        `Unexpected value at (${row},${column}).\n${renderBoardState(state)}`,
    );
}

/**
 * Tests for the Board abstract data type.
 */
describe('Board', function() {

    it('look shows all cards face down initially', async function() {
        const board = await makeBoard();
        const view = await board.look('alice');
        logBoardState('Initial look', view);
        const { height, width } = parseBoardState(view);
        for (let row = 0; row < height; row += 1) {
            for (let column = 0; column < width; column += 1) {
                expectCell(view, row, column, 'down');
            }
        }
    });

    it('matching pair removed on next first-card attempt', async function() {
        const board = await makeBoard();
        await board.flip('alice', 0, 0);
        const afterSecond = await board.flip('alice', 0, 2);
        logBoardState('After matching pair', afterSecond);
        expectCell(afterSecond, 0, 0, 'my A');
        expectCell(afterSecond, 0, 2, 'my A');

        const afterNewFirst = await board.flip('alice', 1, 1);
        logBoardState('After starting new turn', afterNewFirst);
        expectCell(afterNewFirst, 0, 0, 'none');
        expectCell(afterNewFirst, 0, 2, 'none');
        assert.ok(cell(afterNewFirst, 1, 1).startsWith('my '), renderBoardState(afterNewFirst));
    });

    it('mismatch leaves cards up then flips down later', async function() {
        const board = await makeBoard();
        await board.flip('alice', 0, 0);
        await board.flip('alice', 0, 1);
        const afterMismatch = await board.look('alice');
        logBoardState('After mismatch', afterMismatch);
        expectCell(afterMismatch, 0, 0, 'up A');
        expectCell(afterMismatch, 0, 1, 'up B');

        const afterNextFirst = await board.flip('alice', 2, 2);
        logBoardState('After next first attempt', afterNextFirst);
        expectCell(afterNextFirst, 0, 0, 'down');
        expectCell(afterNextFirst, 0, 1, 'down');
    });

    it('waiting player gains control when card becomes free', async function() {
        const board = await makeBoard();
        await board.flip('alice', 0, 0);
        const bobPromise = board.flip('bob', 0, 0);
        await board.flip('alice', 0, 1); // mismatch releases control
        const bobView = await bobPromise;
        logBoardState('Bob acquires card', bobView);
        expectCell(bobView, 0, 0, 'my A');
    });

    it('map replaces card labels consistently', async function() {
        const board = await makeBoard();
        const mapped = await board.map('mapper', async (card) => {
            return card === 'A' ? 'X' : card === 'B' ? 'Y' : card;
        });
        logBoardState('After mapping', mapped);
        const { cells } = parseBoardState(mapped);
        for (const row of cells) {
            for (const value of row) {
                if (value.startsWith('down')) {
                    continue;
                }
                assert.ok(value.includes('X') || value.includes('Y'), `unexpected value ${value}\n${renderBoardState(mapped)}`);
            }
        }
    });

    it('watch resolves after board change', async function() {
        const board = await makeBoard();
        const watchPromise = board.watch('watcher');
        await board.flip('player1', 0, 0);
        const watchedState = await watchPromise;
        logBoardState('Watch notification', watchedState);
        assert.ok(watchedState.includes('up A') || watchedState.includes('my A'), renderBoardState(watchedState));
    });

    it('reset restores original board', async function() {
        const board = await makeBoard();
        await board.flip('alice', 0, 0);
        await board.flip('alice', 0, 2);
        await board.flip('alice', 1, 1);
        const resetView = await board.reset('referee');
        logBoardState('After reset', resetView);
        const { height, width } = parseBoardState(resetView);
        for (let row = 0; row < height; row += 1) {
            for (let column = 0; column < width; column += 1) {
                expectCell(resetView, row, column, 'down');
            }
        }
        const aliceView = await board.look('alice');
        logBoardState('Alice after reset', aliceView);
        expectCell(aliceView, 0, 0, 'down');
    });

    it('first-card attempt fails if space is empty', async function() {
        const board = await makeBoard();
        await board.flip('alice', 0, 0);
        await board.flip('alice', 0, 2);
        await board.flip('alice', 1, 1);
        const postRemoval = await board.look('bob');
        logBoardState('After removal before empty flip', postRemoval);
        expectCell(postRemoval, 0, 0, 'none');
        await assert.rejects(() => board.flip('bob', 0, 0), /no card at that location/);
    });

    it('second-card attempt fails if space was removed', async function() {
        const board = await makeBoard();
        await board.flip('charlie', 0, 1);
        await board.flip('charlie', 0, 3);
        await board.flip('charlie', 1, 1);
        const cleared = await board.look('observer');
        logBoardState('After clearing second-card target', cleared);
        expectCell(cleared, 0, 1, 'none');
        await board.flip('alice', 0, 0);
        await assert.rejects(() => board.flip('alice', 0, 1), /no card at that location/);
        const afterFailure = await board.look('alice');
        logBoardState('After second-card failure', afterFailure);
        expectCell(afterFailure, 0, 0, 'up A');
    });

    it('second-card attempt fails if card controlled by another player', async function() {
        const board = await makeBoard();
        await board.flip('bob', 0, 1);
        await board.flip('alice', 0, 0);
        await assert.rejects(() => board.flip('alice', 0, 1), /card already controlled/);
        const aliceView = await board.look('alice');
        logBoardState('Alice after controlled-card failure', aliceView);
        expectCell(aliceView, 0, 0, 'up A');
        const bobView = await board.look('bob');
        logBoardState('Bob still controls card', bobView);
        expectCell(bobView, 0, 1, 'my B');
    });

    it('rejects invalid coordinates', async function() {
        const board = await makeBoard();
        await assert.rejects(() => board.flip('alice', 100, 0));
    });
});
