import zxcvbn from 'zxcvbn';
import { loginT as t } from './i18n';

export interface PasswordStrengthResult {
    score: number; // 0-4: 0=very weak, 1=weak, 2=fair, 3=strong, 4=very strong
    label: string;
    color: string;
    isValid: boolean;
    feedback: string[];
}

const MIN_PASSWORD_LENGTH = 6;

/**
 * Evaluate password strength using zxcvbn library.
 * Returns a score from 0-4 with localized labels and suggestions.
 */
export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
    if (!password) {
        return {
            score: 0,
            label: '',
            color: '#ddd',
            isValid: false,
            feedback: [],
        };
    }

    const feedback: string[] = [];

    // Minimum length check
    if (password.length < MIN_PASSWORD_LENGTH) {
        feedback.push(t('password.lengthMin', { values: { count: MIN_PASSWORD_LENGTH } }));
    }

    // Use zxcvbn for intelligent strength evaluation
    const result = zxcvbn(password);
    const score = result.score;

    // Add zxcvbn suggestions (translated to Chinese)
    if (result.feedback.warning) {
        const warningMap: Record<string, string> = {
            'Straight rows of keys are easy to guess': t('password.feedback.keyboard'),
            'Short keyboard patterns are easy to guess': t('password.feedback.shortKeyboard'),
            'Repeats like "aaa" are easy to guess': t('password.feedback.repeats'),
            'Repeats like "abcabcabc" are only slightly harder to guess than "abc"': t('password.feedback.repeatPattern'),
            'Sequences like abc or 6543 are easy to guess': t('password.feedback.sequence'),
            'Recent years are easy to guess': t('password.feedback.recentYears'),
            'Dates are often easy to guess': t('password.feedback.dates'),
            'This is a top-10 common password': t('password.feedback.common10'),
            'This is a top-100 common password': t('password.feedback.common100'),
            'This is a very common password': t('password.feedback.commonPassword'),
            'This is similar to a commonly used password': t('password.feedback.similar'),
            'A word by itself is easy to guess': t('password.feedback.word'),
            'Names and surnames by themselves are easy to guess': t('password.feedback.name'),
            'Common names and surnames are easy to guess': t('password.feedback.names'),
        };
        const translated = warningMap[result.feedback.warning] || result.feedback.warning;
        feedback.push(translated);
    }

    // Add suggestions
    if (result.feedback.suggestions) {
        const suggestionMap: Record<string, string> = {
            'Use a few words, avoid common phrases': t('password.feedback.useWords'),
            'No need for symbols, digits, or uppercase letters': t('password.feedback.noNeedSymbols'),
            'Add another word or two. Uncommon words are better.': t('password.feedback.addWords'),
            'Capitalization doesn\'t help very much': t('password.feedback.capitalization'),
            'All-uppercase is almost as easy to guess as all-lowercase': t('password.feedback.allUpper'),
            'Reversed words aren\'t much harder to guess': t('password.feedback.reversed'),
            'Predictable substitutions like \'@\' instead of \'a\' don\'t help very much': t('password.feedback.substitution'),
            'Avoid repeated words and characters': t('password.feedback.avoidRepeat'),
            'Avoid sequences': t('password.feedback.avoidSequences'),
            'Avoid recent years': t('password.feedback.avoidRecentYears'),
            'Avoid years that are associated with you': t('password.feedback.avoidYears'),
            'Avoid dates and years that are associated with you': t('password.feedback.avoidDates'),
        };
        result.feedback.suggestions.forEach(suggestion => {
            const translated = suggestionMap[suggestion] || suggestion;
            if (!feedback.includes(translated)) {
                feedback.push(translated);
            }
        });
    }

    // Determine label and color based on score
    const labels = [
        t('password.levels.veryWeak'),
        t('password.levels.weak'),
        t('password.levels.fair'),
        t('password.levels.strong'),
        t('password.levels.veryStrong'),
    ];
    const colors = ['#ff4d4f', '#ff7a45', '#faad14', '#52c41a', '#389e0d'];

    // Password is valid if meets minimum length (strength indicator is advisory only)
    const isValid = password.length >= MIN_PASSWORD_LENGTH;

    return {
        score,
        label: labels[score],
        color: colors[score],
        isValid,
        feedback: feedback.slice(0, 2), // Limit to 2 feedback items
    };
}

/**
 * Validate password for submission.
 * Returns error message if invalid, null if valid.
 */
export function validatePassword(password: string): string | null {
    if (!password) {
        return t('password.required');
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        return t('password.lengthMin', { values: { count: MIN_PASSWORD_LENGTH } });
    }

    const result = evaluatePasswordStrength(password);
    if (!result.isValid) {
        return t('password.tooWeak');
    }

    return null;
}
