/**
 * Test to verify that Voice component handles AMR decode promise rejections.
 * Related to: Issue #341 - Voice component AMR decoding Promise not handled
 */

describe('Voice component AMR promise rejection handling', () => {
    describe('initWithArrayBuffer error handling', () => {
        it('should have catch handler for initWithArrayBuffer when voiceBuff exists', () => {
            // Read the Voice component source code and verify .catch() handlers exist
            const fs = require('fs');
            const path = require('path');

            const voiceFilePath = path.join(
                __dirname,
                '../../../../packages/dmworkbase/src/Messages/Voice/index.tsx'
            );

            const content = fs.readFileSync(voiceFilePath, 'utf8');

            // Find all initWithArrayBuffer calls
            const initCalls = content.match(/initWithArrayBuffer\([^)]+\)\.then\([^)]*\)/g) || [];

            // Each initWithArrayBuffer().then() should have a corresponding .catch()
            // Check that there are catch handlers after the then blocks
            const catchPattern = /initWithArrayBuffer\([^)]+\)\.then\([^}]+\}\)\.catch\(/g;
            const catchMatches = content.match(catchPattern) || [];

            // We expect 2 catch handlers (one for voiceBuff case, one for xhr response case)
            expect(catchMatches.length).toBe(2);
        });

        it('should log error message on AMR decode failure', () => {
            const fs = require('fs');
            const path = require('path');

            const voiceFilePath = path.join(
                __dirname,
                '../../../../packages/dmworkbase/src/Messages/Voice/index.tsx'
            );

            const content = fs.readFileSync(voiceFilePath, 'utf8');

            // Verify that console.error is called with descriptive message
            expect(content).toContain("console.error('Failed to decode AMR audio:'");
        });

        it('should reset play status on AMR decode failure', () => {
            const fs = require('fs');
            const path = require('path');

            const voiceFilePath = path.join(
                __dirname,
                '../../../../packages/dmworkbase/src/Messages/Voice/index.tsx'
            );

            const content = fs.readFileSync(voiceFilePath, 'utf8');

            // Verify that setState is called with playStatusWaitPlay in catch handlers
            // This ensures the UI is reset to a usable state after failure
            const catchBlocks = content.match(/\.catch\(\(error: Error\)[^}]+\}/g) || [];

            expect(catchBlocks.length).toBeGreaterThanOrEqual(2);

            // Both catch blocks should set playStatus to waiting state
            catchBlocks.forEach(block => {
                expect(block).toContain('playStatus: playStatusWaitPlay');
            });
        });
    });
});
