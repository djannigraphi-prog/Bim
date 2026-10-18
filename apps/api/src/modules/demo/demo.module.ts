import { Controller, Get, Header, Inject, Module, NotFoundException, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { Public } from '../auth/auth.decorators';
import { DeliveryService } from '../delivery/delivery.service';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../demo/accounts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Démonstration gratuite sur un ordinateur (NODE_ENV=development et DEMO_MODE seulement ; 404 partout ailleurs) :
 * page /demo pour la personne qui présente — adresse à saisir dans l'app, comptes de démo, codes reçus (envoi factice,
 * aucun SMS payé). La configuration refuse DEMO_MODE en production.
 */
@ApiExcludeController()
@Controller('demo')
export class DemoController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly delivery: DeliveryService,
  ) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  page(@Res() res: Response) {
    if (!this.delivery.demoPageEnabled) throw new NotFoundException();
    const codes = this.delivery.demoOutbox
      .map((m) => {
        const code = /(\d{6})/.exec(m.body)?.[1] ?? '';
        return `<tr><td>${esc(m.sentAt.toLocaleTimeString('fr-FR'))}</td><td>${esc(m.destination)}</td><td class="code">${esc(code)}</td><td>${esc(m.body)}</td></tr>`;
      })
      .join('');
    const accounts = DEMO_ACCOUNTS.map((a) => `<tr><td>${esc(a.fullName)}</td><td>${esc(a.phone)}</td><td>@${esc(a.username)}</td><td>${esc(a.role)}</td></tr>`).join('');
    const url = this.cfg.DEMO_PUBLIC_URL || 'adresse de cet ordinateur sur le Wi-Fi, port 3000';
    res.type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3"><title>BIM · démo</title>
<style>body{font:16px system-ui,sans-serif;margin:24px;color:#101116;background:#fff}h1{color:#F20D3A}table{border-collapse:collapse;width:100%;margin:8px 0 24px}
td,th{border-bottom:1px solid #e2e2e7;padding:8px;text-align:left}.code{font:700 28px ui-monospace,monospace;color:#F20D3A}.url{font:700 24px ui-monospace,monospace;background:#fff4d6;padding:8px 12px;border-radius:8px;display:inline-block}</style></head>
<body><h1>BIM · démonstration</h1>
<p>Dans l'app, sur l'écran d'accueil, touchez « Serveur de démo » et saisissez :</p><p class="url">${esc(url)}</p>
<h2>Codes reçus (aucun SMS envoyé)</h2><table><tr><th>Heure</th><th>Destinataire</th><th>Code</th><th>Message</th></tr>${codes || '<tr><td colspan="4">Aucun code pour l’instant. La page se met à jour toute seule.</td></tr>'}</table>
<h2>Comptes de démo</h2><p>Mot de passe commun : <b>${esc(DEMO_PASSWORD)}</b></p><table><tr><th>Nom</th><th>Téléphone</th><th>Nom d'utilisateur</th><th>Rôle</th></tr>${accounts}</table>
<p>Mode démo : aucun argent réel, aucun service payant.</p></body></html>`);
  }
}

@Module({ controllers: [DemoController] })
export class DemoModule {}
