const { prepare } = require('../database');
const { v4: uuidv4 } = require('uuid');

function auditLog(action, entityType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      if (res.statusCode < 400) {
        try {
          prepare(`INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            uuidv4(),
            req.user?.id || 'system',
            action,
            entityType,
            req.params?.id || data?.id || null,
            JSON.stringify({ method: req.method, path: req.path, body: req.method !== 'GET' ? req.body : undefined }),
            req.ip
          );
        } catch (err) {
          console.error('Audit log error:', err.message);
        }
      }
      return originalJson(data);
    };
    next();
  };
}

module.exports = { auditLog };
