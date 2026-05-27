import React from 'react';
import { evaluatePasswordStrength, PasswordStrengthResult } from './passwordStrength';
import { loginT as t } from './i18n';

interface PasswordStrengthIndicatorProps {
    password: string;
    onChange?: (result: PasswordStrengthResult) => void;
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        width: '286px',
        maxWidth: 'calc(100vw - 60px)',
        margin: '0 auto 12px auto',
        boxSizing: 'border-box' as const,
    },
    barContainer: {
        display: 'flex',
        gap: '4px',
        marginBottom: '4px',
    },
    bar: {
        flex: 1,
        height: '4px',
        borderRadius: '2px',
        backgroundColor: '#e8e8e8',
        transition: 'background-color 0.2s',
    },
    labelRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        minHeight: '18px',
    },
    label: {
        fontSize: '12px',
        fontWeight: 500,
    },
    feedback: {
        fontSize: '12px',
        color: '#8c8c8c',
        margin: 0,
        lineHeight: 1.4,
    },
};

export const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({
    password,
    onChange,
}) => {
    const result = evaluatePasswordStrength(password);

    React.useEffect(() => {
        if (onChange) {
            onChange(result);
        }
    }, [password, result.score]);

    if (!password) {
        return null;
    }

    const bars = [0, 1, 2, 3, 4];

    return (
        <div style={styles.container}>
            <div style={styles.barContainer}>
                {bars.map((index) => (
                    <div
                        key={index}
                        style={{
                            ...styles.bar,
                            backgroundColor: index <= result.score ? result.color : '#e8e8e8',
                        }}
                    />
                ))}
            </div>
            <div style={styles.labelRow}>
                <span style={{ ...styles.label, color: result.color }}>
                    {t('password.label')} {result.label}
                </span>
            </div>
            {result.feedback.length > 0 && (
                <p style={styles.feedback}>
                    {result.feedback[0]}
                </p>
            )}
        </div>
    );
};

export default PasswordStrengthIndicator;
