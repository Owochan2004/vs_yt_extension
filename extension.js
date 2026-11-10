const vscode = require('vscode');
const WebSocket = require('ws');

let wss = null;

function activate(context) {
    console.log('[YT Extension] Activada al iniciar VS Code.');

    // 1. INICIAR EL SERVIDOR WEBSOCKET AUTOMÁTICAMENTE
    try {
        wss = new WebSocket.Server({ port: 9999 });

        wss.on('connection', (ws) => {
            ws.on('message', (message) => {
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(message.toString());
                    }
                });
            });
        });

        console.log('[YT Extension] Puente WebSocket activo en puerto 9999.');
    } catch (err) {
        console.error('[YT Extension] Error al iniciar WebSocket:', err);
    }

    // 2. AUTO-CONFIGURAR SETTINGS.JSON SIN QUE EL USUARIO HAGA NADA
    try {
        const config = vscode.workspace.getConfiguration('vscode_custom_css');
        
        // Obtener la ruta absoluta donde quedó instalada esta extensión
        // FORMA CORRECTA PARA WINDOWS (C: sin %3A):
        const jsUri = 'file:///' + context.asAbsolutePath('vscode-bg.js').replace(/\\/g, '/');
        const cssUri = 'file:///' + context.asAbsolutePath('vscode-bg.css').replace(/\\/g, '/');

        let currentImports = config.get('imports') || [];

        // Si las rutas no están en settings.json, las agregamos solas
        const needsJs = !currentImports.includes(jsUri);
        const needsCss = !currentImports.includes(cssUri);

        if (needsJs || needsCss) {
            const updatedImports = [...new Set([...currentImports, jsUri, cssUri])];
            config.update('imports', updatedImports, vscode.ConfigurationTarget.Global).then(() => {
                // Notificar al usuario para recargar la primera vez
                vscode.window.showInformationMessage(
                    'YouTube Visualizer configurado automáticamente. Reinicia para aplicar.',
                    'Recargar ahora'
                ).then(choice => {
                    if (choice === 'Recargar ahora') {
                        vscode.commands.executeCommand('extension.updateCustomCSS');
                    }
                });
            });
        }
    } catch (err) {
        console.error('[YT Extension] Error al auto-configurar preferencias:', err);
    }
}

// SE APAGA SOLO CUANDO SE CIERRAN TODOS LOS VS CODE
function deactivate() {
    if (wss) {
        wss.close();
        console.log('[YT Extension] Puente cerrado.');
    }
}

module.exports = {
    activate,
    deactivate
};