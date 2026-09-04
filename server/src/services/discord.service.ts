import * as configService from './config.service.js';

// L'URL du webhook et l'ID du rôle à taguer sont des secrets/identifiants
// d'infra (server/.env, DISCORD_WEBHOOK_URL / DISCORD_ALERT_ROLE_ID) — jamais
// stockés en BDD ni exposés via le panel admin_config. Le toggle
// `discord_notifications_enabled` (BDD) permet au MSP de couper l'alerte
// sans toucher aux secrets.

const GAME_TYPE_LABELS: Record<string, string> = {
  quiz: 'Quiz',
};

const EMBED_COLOR = 0x22c55e; // vert émeraude, couleur d'accent de l'app

export async function sendMinigameLaunchedAlert(session: {
  id: number;
  title: string;
  gameType: string;
  entryFee: number | null;
}): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const enabled = await configService.getConfigBool('discord_notifications_enabled', false);
  if (!enabled) return;

  const roleId = process.env.DISCORD_ALERT_ROLE_ID;
  const clientOrigin = process.env.CLIENT_ORIGIN;
  const link = clientOrigin ? `${clientOrigin}/mini-jeux/${session.id}` : null;
  const entryLabel = session.entryFee ? `${session.entryFee} SP` : 'Free';

  const payload = {
    content: roleId ? `<@&${roleId}>` : undefined,
    allowed_mentions: roleId ? { roles: [roleId] } : { parse: [] },
    embeds: [
      {
        title: '🎮 Nouveau mini-jeu disponible',
        description: `**${session.title}**`,
        color: EMBED_COLOR,
        fields: [
          { name: 'Type', value: GAME_TYPE_LABELS[session.gameType] ?? session.gameType, inline: true },
          { name: 'Entrée', value: entryLabel, inline: true },
        ],
        url: link ?? undefined,
        timestamp: new Date().toISOString(),
        footer: { text: 'Points Sourires' },
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Discord webhook a répondu ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    // Une alerte Discord ratée ne doit jamais faire échouer la création du mini-jeu.
    console.error('Échec de l’envoi de l’alerte Discord :', err);
  }
}
