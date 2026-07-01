/**
 * Tests for performance optimization: arrow function properties vs .bind(this) in render
 *
 * This test verifies that the refactored components use arrow function class properties
 * instead of .bind(this) in render methods, which prevents unnecessary re-renders.
 *
 * Related to issue #44: React 组件性能优化：减少不必要的重渲染
 */

import * as fs from 'fs';
import * as path from 'path';

describe('Performance: Arrow function properties vs .bind(this) in render', () => {
  // NOTE (architecture migration): MessageInput is no longer a class component.
  // It is now a function component (`const MessageInput: React.FC<...>`) whose
  // handlers are stabilised with useCallback / useRef instead of class arrow
  // properties. The original perf intent — handler identity stays stable across
  // renders, no fresh closure per render (which `.bind(this)` would create) — is
  // therefore asserted differently for MessageInput below. WKAvatar is still a
  // class component, but its old `handleLoad` arrow property was removed in a
  // refactor (it now only tracks load errors via `handleImgError`), so that
  // obsolete method has been dropped here. Both negative `.bind(this)` regression
  // guards are preserved unchanged.
  const componentsToCheck = [
    {
      name: 'VoiceCell',
      path: 'packages/dmworkbase/src/Messages/Voice/index.tsx',
      methods: ['playOrPauseVoice'],
    },
    {
      name: 'ConversationList',
      path: 'packages/dmworkbase/src/Components/ConversationList/index.tsx',
      methods: ['_handleScroll'],
    },
    {
      name: 'ListItemAvatar',
      path: 'packages/dmworkbase/src/Components/ListItemAvatar/index.tsx',
      methods: ['onFileChange', 'onFileClick'],
    },
    {
      name: 'WKAvatar',
      path: 'packages/dmworkbase/src/Components/WKAvatar/index.tsx',
      methods: ['handleImgError'],
    },
  ];

  describe('MessageInput component (function component)', () => {
    let fileContent: string;

    beforeAll(() => {
      const fullPath = path.resolve(
        __dirname,
        '../../../../packages/dmworkbase/src/Components/MessageInput/index.tsx'
      );
      fileContent = fs.readFileSync(fullPath, 'utf-8');
    });

    it('is a function component (the class-component arrow-property rule no longer applies)', () => {
      expect(fileContent).toMatch(/const\s+MessageInput\s*:\s*React\.FC/);
      expect(fileContent).not.toMatch(/class\s+MessageInput\b/);
    });

    it('stabilises handlers with useCallback / useRef instead of per-render closures', () => {
      // Function-component equivalent of the arrow-property optimisation: handler
      // identity is memoised so children/editor do not re-bind every render.
      expect(fileContent).toMatch(/useCallback/);
      expect(fileContent).toMatch(/editorHandleKeyDownRef/);
    });

    it('should NOT use .bind(this) anywhere (regression guard)', () => {
      expect(fileContent).not.toMatch(/\.bind\(this\)/);
    });
  });

  componentsToCheck.forEach(({ name, path: filePath, methods }) => {
    describe(`${name} component`, () => {
      let fileContent: string;

      beforeAll(() => {
        const fullPath = path.resolve(__dirname, '../../../../', filePath);
        fileContent = fs.readFileSync(fullPath, 'utf-8');
      });

      methods.forEach((method) => {
        it(`should define ${method} as an arrow function property`, () => {
          // Check that the method is defined as an arrow function property
          // Pattern: methodName = (...) => { or methodName = () => {
          const arrowFunctionPattern = new RegExp(`${method}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{`);
          expect(fileContent).toMatch(arrowFunctionPattern);
        });

        it(`should NOT use .bind(this) for ${method} in render`, () => {
          // Check that .bind(this) is not used with this method in render
          const bindPattern = new RegExp(`${method}\\.bind\\(this\\)`);
          expect(fileContent).not.toMatch(bindPattern);
        });
      });
    });
  });

  describe('General render method patterns', () => {
    it('should not have .bind(this) patterns in MessageInput render', () => {
      const filePath = path.resolve(
        __dirname,
        '../../../../packages/dmworkbase/src/Components/MessageInput/index.tsx'
      );
      const content = fs.readFileSync(filePath, 'utf-8');

      // Extract render method content (simplified check)
      const renderMatch = content.match(/render\s*\(\)\s*\{[\s\S]*$/);
      if (renderMatch) {
        const renderContent = renderMatch[0];
        expect(renderContent).not.toMatch(/\.bind\(this\)/);
      }
    });

    it('should not have .bind(this) patterns in WKAvatar render', () => {
      const filePath = path.resolve(
        __dirname,
        '../../../../packages/dmworkbase/src/Components/WKAvatar/index.tsx'
      );
      const content = fs.readFileSync(filePath, 'utf-8');

      const renderMatch = content.match(/render\s*\(\)\s*\{[\s\S]*$/);
      if (renderMatch) {
        const renderContent = renderMatch[0];
        expect(renderContent).not.toMatch(/\.bind\(this\)/);
      }
    });
  });
});
