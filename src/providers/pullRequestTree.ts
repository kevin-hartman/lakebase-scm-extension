import * as vscode from 'vscode';
import { SchemaScmProvider } from './schemaScmProvider';

export class PullRequestTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private scmProvider: SchemaScmProvider) {
    scmProvider.onDidRefresh(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const states = this.scmProvider.getPr();
    return states.map(state => {
      const name = decodeURIComponent(state.resourceUri.path.split('/').pop() || '');
      const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
      item.resourceUri = state.resourceUri;
      item.iconPath = state.decorations?.iconPath;
      item.tooltip = state.decorations?.tooltip;
      item.command = state.command;
      return item;
    });
  }
}
