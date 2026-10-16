import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class OfferDto {
  @ApiProperty({ example: 'Bonjour ! Nos tenues de sport respirantes sont idéales pour ton programme.', maxLength: 500 })
  @IsString()
  @Length(10, 500)
  message!: string;

  @ApiPropertyOptional({ type: [String], description: 'Articles en ligne de ta boutique (3 au plus)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsUUID('all', { each: true })
  productIds?: string[];
}

export class ReceiveOffersDto {
  @ApiProperty({ description: 'Recevoir les offres des marchands pour ce projet (écran 21)' }) @IsBoolean() receive!: boolean;
}
