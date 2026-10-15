import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthContext, CurrentAuth, RequireSpace } from '../auth/auth.decorators';
import { PeniMessageDto, StartPeniConversationDto } from './dto';
import { PeniService } from './peni.service';

/** Peni (lot 3, écran 25) : discussion guidée qui prépare un projet ; réservé à l'espace utilisateur. */
@ApiTags('Peni')
@ApiBearerAuth()
@RequireSpace('user')
@Controller('v1/peni/conversations')
export class PeniController {
  constructor(private readonly peni: PeniService) {}

  @Post()
  @ApiOperation({ summary: 'Commencer une discussion avec Peni (sans IA : réponses écrites par l’équipe BIM)' })
  start(@CurrentAuth() a: AuthContext, @Body() dto: StartPeniConversationDto) {
    return this.peni.start(a.userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Relire une discussion avec Peni' })
  get(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.peni.get(a.userId, id);
  }

  @Post(':id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Répondre à Peni (message libre ou réponse rapide) ; renvoie le brouillon de projet quand tout est noté' })
  send(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PeniMessageDto) {
    return this.peni.send(a.userId, id, dto);
  }
}
