const agent = process.env.npm_config_user_agent || '';
if (!agent.startsWith('pnpm/')) {
  console.error('\nBugReplay uses pnpm workspaces. Installing with npm leaves internal packages unlinked.\nUse: npx pnpm@10.12.1 install\nThen: npx pnpm@10.12.1 dev\n');
  process.exit(1);
}
