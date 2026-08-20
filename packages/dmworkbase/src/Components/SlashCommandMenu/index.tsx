import React, { Component } from "react";
import { Dropdown } from "@octo/ui";
import { I18nContext } from "../../i18n";
import "./index.css";

export interface BotCommand {
    command: string;
    description: string;
}

interface SlashCommandMenuProps {
    commands: BotCommand[];
    filter: string;
    visible: boolean;
    activeIndex: number;
    onSelect: (command: BotCommand) => void;
}

export default class SlashCommandMenu extends Component<SlashCommandMenuProps> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private activeItemRef = React.createRef<HTMLButtonElement>();

    componentDidUpdate(prevProps: SlashCommandMenuProps) {
        if (prevProps.activeIndex !== this.props.activeIndex && this.activeItemRef.current) {
            this.activeItemRef.current.scrollIntoView({ block: "nearest" });
        }
    }

    getFilteredCommands(): BotCommand[] {
        const { commands, filter } = this.props;
        if (!filter) return commands;
        const lower = filter.toLowerCase();
        return commands.filter(
            (cmd) =>
                cmd.command.toLowerCase().includes(lower) ||
                cmd.description.toLowerCase().includes(lower)
        );
    }

    render() {
        const { visible, activeIndex, onSelect } = this.props;
        if (!visible) return null;

        const filtered = this.getFilteredCommands();
        if (filtered.length === 0) {
            return (
                <div className="wk-slash-command-menu">
                    <Dropdown.Menu>
                        <div className="wk-slash-command-empty">{this.context.t("base.slashCommand.noMatches")}</div>
                    </Dropdown.Menu>
                </div>
            );
        }

        return (
            <div className="wk-slash-command-menu">
                <Dropdown.Menu maxHeight={300}>
                    <div className="wk-slash-command-menu-header">{this.context.t("base.slashCommand.botCommands")}</div>
                    {filtered.map((cmd, index) => (
                        <Dropdown.Item
                            key={cmd.command}
                            ref={index === activeIndex ? this.activeItemRef : undefined}
                            className="wk-slash-command-item"
                            selected={index === activeIndex}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onSelect(cmd);
                            }}
                        >
                            <span className="wk-slash-command-item-content">
                                <span className="wk-slash-command-name">{cmd.command.startsWith('/') ? cmd.command : `/${cmd.command}`}</span>
                                <span className="wk-slash-command-desc">{cmd.description}</span>
                            </span>
                        </Dropdown.Item>
                    ))}
                </Dropdown.Menu>
            </div>
        );
    }
}
