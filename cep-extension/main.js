/**
 * Illustrator MCP Bridge — CEP Extension
 *
 * Illustrator 内の CEP パネルとして動作し、localhost に HTTP サーバーを立ち上げる。
 * illustrator-mcp-server が ILLUSTRATOR_MCP_TRANSPORT=cep のとき、
 * ここに JSX コードを POST して ExtendScript を実行する。
 *
 * 通信プロトコル:
 *   POST /eval
 *   Body:    { "jsxCode": "<ExtendScript コード文字列>" }
 *   Success: { "ok": true,  "result": "<evalScript 戻り値 (JSON 文字列)>" }
 *   Error:   { "ok": false, "error": "<エラーメッセージ>" }
 */
(function () {
  'use strict';

  // ─── ポート設定 ──────────────────────────────────────────────────────────
  // illustrator-mcp-server 側の CEP_PORT (49374) と合わせること
  var PORT = 49374;

  // ─── UI 要素 ────────────────────────────────────────────────────────────
  var dot   = document.getElementById('dot');
  var label = document.getElementById('label');
  var portEl = document.getElementById('port');

  function setStatus(state, text) {
    dot.className = state;   // 'running' | 'error' | ''
    label.textContent = text;
  }

  // ─── evalScript ラッパー ────────────────────────────────────────────────
  // CSInterface.js 不要：CEP ランタイムのネイティブ API を直接使用
  // window.__adobe_cep__.evalScript(code, id) でリクエストし、
  // 'message' イベントで結果を受け取る。
  var _pendingCalls = {};
  var _callCounter  = 0;

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg && msg.type === 'evalScript') {
      var cb = _pendingCalls[msg.callbackId];
      if (cb) {
        delete _pendingCalls[msg.callbackId];
        cb(msg.result);
      }
    }
  });

  function evalIllustrator(code, callback) {
    var id = String(++_callCounter);
    _pendingCalls[id] = callback;
    window.__adobe_cep__.evalScript(code, id);
  }

  // ─── HTTP サーバー ───────────────────────────────────────────────────────
  var http   = require('http');
  var server = http.createServer(function (req, res) {

    // POST /eval のみ受け付ける
    if (req.method !== 'POST' || req.url !== '/eval') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
      return;
    }

    var body = '';
    req.on('data', function (chunk) { body += chunk.toString(); });
    req.on('end', function () {
      var jsxCode;
      try {
        var parsed = JSON.parse(body);
        jsxCode = parsed.jsxCode;
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON: ' + e.message }));
        return;
      }

      if (!jsxCode || typeof jsxCode !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Missing or invalid jsxCode' }));
        return;
      }

      evalIllustrator(jsxCode, function (result) {
        // evalScript エラー時は 'EvalScript error.' が返ることがある
        if (result === 'EvalScript error.' || result == null) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: 'ExtendScript error' + (result ? ': ' + result : ''),
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: result }));
        }
      });
    });

    req.on('error', function (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
  });

  server.on('error', function (e) {
    setStatus('error', 'Error: ' + e.message);
    console.error('[MCP Bridge] Server error:', e);
  });

  server.listen(PORT, '127.0.0.1', function () {
    setStatus('running', 'MCP Bridge: Running');
    portEl.textContent = 'localhost:' + PORT;
    console.log('[MCP Bridge] Listening on port ' + PORT);
  });

  // パネルが閉じられたときにサーバーを停止
  window.addEventListener('beforeunload', function () {
    server.close();
  });
})();
