import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'

export class RegisterDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(8, { message: '密码至少 8 位' })
  @MaxLength(64)
  password!: string

  @IsString()
  @IsNotEmpty({ message: '昵称不能为空' })
  @MaxLength(16, { message: '昵称最多 16 字符' })
  nickname!: string
}
