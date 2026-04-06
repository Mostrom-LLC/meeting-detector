function parseArgs(raw) {
  if (!raw) {
    return [];
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed;
      }
    } catch {
      // Fall through to shell-style splitting below.
    }
  }

  const matches = trimmed.match(/(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+)/g) || [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ''));
}

async function loadSdk() {
  try {
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
    ]);
    return { Client, StdioClientTransport };
  } catch (error) {
    throw new Error(
      'Unable to load @modelcontextprotocol/sdk. Run `npm install` so the native MCP client can connect.',
      { cause: error }
    );
  }
}

export async function createNativeMcpClient() {
  const command = process.env.NATIVE_MCP_SERVER_CMD;
  if (!command) {
    throw new Error(
      'Missing NATIVE_MCP_SERVER_CMD. Set it to the native-devtools MCP server executable before running live native E2E.'
    );
  }

  const args = parseArgs(process.env.NATIVE_MCP_SERVER_ARGS || '');
  const { Client, StdioClientTransport } = await loadSdk();
  const transport = new StdioClientTransport({ command, args });
  const client = new Client(
    {
      name: 'meeting-native-e2e',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(
      `Failed to connect to native MCP server using ${command} ${args.join(' ')}`.trim(),
      { cause: error }
    );
  }

  return {
    rawClient: client,
    async callTool({ name, arguments: toolArguments = {} }) {
      return client.callTool({ name, arguments: toolArguments });
    },
    async close() {
      if (typeof client.close === 'function') {
        await client.close();
      }
    },
  };
}
