const fs = require('fs');
// A tiny 16x16 blue PNG
const base64Png = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsQAAA7EAZUrDhsAAAApSURBVDhPY3jMwPCfgQSAcQCRDDAaGkYwoK+ZUT+gM4yGQf2AzjAaBnQAAC3fC+kF3zJPAAAAAElFTkSuQmCC";
const buffer = Buffer.from(base64Png, 'base64');
fs.writeFileSync('icons/icon16.png', buffer);
fs.writeFileSync('icons/icon48.png', buffer);
fs.writeFileSync('icons/icon128.png', buffer);
