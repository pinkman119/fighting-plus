import { IsNotEmpty, IsString, Length } from 'class-validator'

export class JoinRoomDto {
  @IsString()
  @IsNotEmpty()
  @Length(4, 10)
  inviteCode!: string
}
