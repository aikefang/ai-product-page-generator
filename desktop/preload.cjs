const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("turingDesktop", {
  runtime: "desktop",
});
