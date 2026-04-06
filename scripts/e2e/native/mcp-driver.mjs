function parseToolResponse(response) {
  if (!response) {
    return null;
  }

  if (response.structuredContent != null) {
    return response.structuredContent;
  }

  if (typeof response.content === 'string') {
    return tryParseJson(response.content) ?? response.content;
  }

  if (Array.isArray(response.content)) {
    const textParts = [];
    for (const part of response.content) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        textParts.push(part.text);
      }
      if (part?.type === 'json' && part.json != null) {
        return part.json;
      }
      if (part?.json != null) {
        return part.json;
      }
    }
    if (textParts.length) {
      const joined = textParts.join('\n');
      return tryParseJson(joined) ?? joined;
    }
  }

  return response;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function collectMatchCandidates(value, matches = []) {
  if (!value) {
    return matches;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMatchCandidates(item, matches);
    }
    return matches;
  }
  if (typeof value !== 'object') {
    return matches;
  }

  const hasCoordinate =
    Number.isFinite(value.x) ||
    Number.isFinite(value.y) ||
    Number.isFinite(value.screen_x) ||
    Number.isFinite(value.screen_y) ||
    Number.isFinite(value.window_x) ||
    Number.isFinite(value.window_y);
  if (hasCoordinate) {
    matches.push(value);
  }

  for (const nested of Object.values(value)) {
    collectMatchCandidates(nested, matches);
  }
  return matches;
}

function normalizeClickPayload(match) {
  if (Number.isFinite(match.screen_x) && Number.isFinite(match.screen_y)) {
    return { x: match.screen_x, y: match.screen_y };
  }
  if (Number.isFinite(match.x) && Number.isFinite(match.y)) {
    return { x: match.x, y: match.y };
  }
  if (
    Number.isFinite(match.window_x) &&
    Number.isFinite(match.window_y) &&
    Number.isFinite(match.window_id)
  ) {
    return { window_id: match.window_id, window_x: match.window_x, window_y: match.window_y };
  }
  return null;
}

export class NativeMcpDriver {
  constructor(client, options = {}) {
    this.client = client;
    this.defaultAppName = options.defaultAppName || null;
  }

  async callTool(name, toolArguments = {}) {
    const response = await this.client.callTool({ name, arguments: toolArguments });
    return {
      raw: response,
      data: parseToolResponse(response),
    };
  }

  async launchApp(appName, args = []) {
    return this.callTool('launch_app', { app_name: appName, args });
  }

  async focusWindow(criteria = {}) {
    if (!criteria.app_name && !criteria.window_id && !criteria.pid) {
      throw new Error('focusWindow requires app_name, window_id, or pid.');
    }
    return this.callTool('focus_window', criteria);
  }

  async typeText(text) {
    return this.callTool('type_text', { text });
  }

  async pressKey(key, modifiers = []) {
    return this.callTool('press_key', { key, modifiers });
  }

  async takeScreenshot(appName = this.defaultAppName) {
    return this.callTool('take_screenshot', {
      mode: 'window',
      app_name: appName || undefined,
      include_ocr: true,
    });
  }

  async wait(ms) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
    return { raw: { waitedMs: ms }, data: { waitedMs: ms } };
  }

  async findText(text, { appName = this.defaultAppName, timeoutMs = 5000, pollMs = 500 } = {}) {
    const startedAt = Date.now();
    let lastResult = null;

    while (Date.now() - startedAt < timeoutMs) {
      lastResult = await this.callTool('find_text', {
        text,
        app_name: appName || undefined,
      });
      const matches = collectMatchCandidates(lastResult.data, []);
      if (matches.length) {
        return {
          ...lastResult,
          matches,
        };
      }
      await this.wait(pollMs);
    }

    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for native text ${JSON.stringify(text)} in ${appName || 'the foreground app'}. Last result: ${JSON.stringify(lastResult?.data ?? null)}`
    );
  }

  async clickText(text, { appName = this.defaultAppName, timeoutMs = 5000, pollMs = 500 } = {}) {
    const found = await this.findText(text, { appName, timeoutMs, pollMs });
    const target = found.matches.map(normalizeClickPayload).find(Boolean);
    if (!target) {
      throw new Error(
        `find_text located ${JSON.stringify(text)} but did not return click coordinates. Result: ${JSON.stringify(found.data)}`
      );
    }

    const clicked = await this.callTool('click', target);
    return {
      raw: clicked.raw,
      data: {
        clickTarget: target,
        findText: found.data,
        click: clicked.data,
      },
    };
  }
}
