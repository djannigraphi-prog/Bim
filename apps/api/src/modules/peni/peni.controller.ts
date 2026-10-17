import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthContext, CurrentAuth, RequireSpace } from '../auth/auth.decorators';
import { EncouragementQueryDto, PeniMessageDto, StartPeniConversationDto } from './dto';
import { PeniService } from './peni.service';

/** Peni (lot 3, écran 25) : discussion guidée qui prépare un projet ; réservé à l'espace utilisateur. */
@ApiTags('Peni')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/peni')
export class PeniController {
  constructor(private readonly peni: PeniService) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Commencer une discussion avec Peni (sans IA : réponses écrites par l’équipe BIM)' })
  start(@CurrentAuth() a: AuthContext, @Body() dto: StartPeniConversationDto) {
    return this.peni.start(a.userId, dto);
  }

  @Get('conversations/resumable')
  @ApiOperation({ summary: 'Discussion interrompue à reprendre (même objet et mêmes choix de départ), ou null' })
  resumable(@CurrentAuth() a: AuthContext, @Query() q: StartPeniConversationDto) {
    return this.peni.resumable(a.userId, q);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Relire une discussion avec Peni' })
  get(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.peni.get(a.userId, id);
  }

  @Post('conversations/:id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Répondre à Peni (message libre ou réponse rapide) ; renvoie le brouillon de projet quand tout est noté' })
  send(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PeniMessageDto) {
    return this.peni.send(a.userId, id, dto);
  }

  @Get('projects/:projectId/encouragement')
  @ApiOperation({ summary: 'Encouragement de Peni pour la journée (27) ou la carte (26) ; heures calmes respectées, aucune notification' })
  encouragement(@CurrentAuth() a: AuthContext, @Param('projectId', ParseUUIDPipe) projectId: string, @Query() q: EncouragementQueryDto) {
    return this.peni.encouragement(a.userId, projectId, q);
  }

  @Get('projects/:projectId/tasks/:taskId/explanation')
  @ApiOperation({ summary: 'Peni explique une tâche du programme (écran 24) ; sans IA, pauses, heures calmes et rappels pris en compte' })
  explainTask(@CurrentAuth() a: AuthContext, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.peni.explainTask(a.userId, projectId, taskId);
  }
}
