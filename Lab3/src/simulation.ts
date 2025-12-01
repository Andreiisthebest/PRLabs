/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import { Board } from './board.js';

/**
 * Example code for simulating a game.
 * 
 * PS4 instructions: you may use, modify, or remove this file,
 *   completing it is recommended but not required.
 * 
 * @throws Error if an error occurs reading or parsing the board
 */
async function simulationMain(): Promise<void> {
    const filename = 'boards/ab.txt';
    const board: Board = await Board.parseFromFile(filename);
    const initialView = await board.look('sim_0');
    const { height, width } = parseDimensions(initialView);
    const players = 4;
    const movesPerPlayer = 100;
    const minDelayMilliseconds = 0.1;
    const maxDelayMilliseconds = 2;

    // start up one or more players as concurrent asynchronous function calls
    const playerPromises: Array<Promise<void>> = [];
    for (let ii = 0; ii < players; ++ii) {
        playerPromises.push(player(ii));
    }
    // wait for all the players to finish (unless one throws an exception)
    await Promise.all(playerPromises);

    /** @param playerNumber player to simulate */
    async function player(playerNumber: number): Promise<void> {
        const playerId = `sim_player_${playerNumber}`;

        for (let jj = 0; jj < movesPerPlayer; ++jj) {
            try {
                await timeout(randomDelay());
                const firstState = await board.flip(playerId, randomInt(height), randomInt(width));
                if (!firstState.includes('my ')) {
                    // flip failed, try again
                    continue;
                }

                await timeout(randomDelay());
                await board.flip(playerId, randomInt(height), randomInt(width));
            } catch (err) {
                console.error(`[${playerId}] flip attempt failed:`, err);
            }
        }
    }

    function randomDelay(): number {
        return minDelayMilliseconds + (Math.random() * (maxDelayMilliseconds - minDelayMilliseconds));
    }
}

/**
 * Random positive integer generator
 * 
 * @param max a positive integer which is the upper bound of the generated number
 * @returns a random integer >= 0 and < max
 */
function randomInt(max: number): number {
    return Math.floor(Math.random() * max);
}

function parseDimensions(boardState: string): { height: number; width: number } {
    const [firstLine] = boardState.split('\n');
    if (firstLine === undefined) {
        throw new Error('board state missing dimensions');
    }
    const match = firstLine.match(/^(\d+)x(\d+)$/);
    if (!match) {
        throw new Error(`invalid board state header: ${firstLine}`);
    }
    return { height: parseInt(match[1]!, 10), width: parseInt(match[2]!, 10) };
}


/**
 * @param milliseconds duration to wait
 * @returns a promise that fulfills no less than `milliseconds` after timeout() was called
 */
async function timeout(milliseconds: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, milliseconds);
    return promise;
}

void simulationMain();
