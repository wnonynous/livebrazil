'use strict';

function healthRoute(_request, response, sendJson) {
  sendJson(response, 200, { ok: true, service: 'LiveBrazil', version: '1.0.0' });
}

module.exports = { healthRoute };
