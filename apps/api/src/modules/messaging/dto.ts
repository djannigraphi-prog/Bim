import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class StartConversationDto {
  @ApiProperty({ example: 'awa.kone', description: 'Nom d’utilisateur de la personne' }) @IsString() @Length(2, 40) username!: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) text?: string;
}
