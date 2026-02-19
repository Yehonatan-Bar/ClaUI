import * as vscode from 'vscode';

/**
 * Phase 2 stub: VS Code PseudoTerminal implementation for terminal mirroring.
 * Will display the same Claude session output in a terminal panel.
 */
export class ClaudePseudoTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number | void>();

  onDidWrite = this.writeEmitter.event;
  onDidClose = this.closeEmitter.event;

  open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
    this.writeLine('ClaUi - Terminal View');
    this.writeLine('(Phase 2: Terminal mirroring not yet implemented)');
    this.writeLine('');
  }

  close(): void {
    // Cleanup
  }

  handleInput(data: string): void {
    // Phase 2: Forward keystrokes to CLI stdin
    void data;
  }

  /** Write a line to the terminal */
  writeLine(text: string): void {
    this.writeEmitter.fire(text + '\r\n');
  }

  /** Write raw text to the terminal (no newline) */
  write(text: string): void {
    this.writeEmitter.fire(text);
  }

  /** Close the terminal */
  terminate(exitCode?: number): void {
    this.closeEmitter.fire(exitCode);
  }
}
