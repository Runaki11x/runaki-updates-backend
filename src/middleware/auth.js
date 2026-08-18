const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "12h" });
}

function requireAuth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    try {
      const decoded = jwt.verify(token, SECRET);
      if (role && decoded.role !== role) {
        return res.status(403).json({ error: "Forbidden for this role" });
      }
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

module.exports = { sign, requireAuth };
