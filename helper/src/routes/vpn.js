'use strict';

function createVpnRoutes(manager) {
  return {
    async status(_request, response, sendJson) {
      const result = await manager.status();
      sendJson(response, result.success ? 200 : 404, result);
    },
    async on(_request, response, sendJson) {
      const result = await manager.connect();
      sendJson(response, result.success ? 200 : 404, result);
    },
    async off(_request, response, sendJson) {
      const result = await manager.disconnect();
      sendJson(response, result.success ? 200 : 404, result);
    }
  };
}

module.exports = { createVpnRoutes };
