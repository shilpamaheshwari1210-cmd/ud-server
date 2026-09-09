import { Request, Response } from 'express';
import { prisma } from '../../../config/prisma';
import { sendSuccess } from '../../../utils/response';

export class SettingsController {
  async getPublicSettings(req: Request, res: Response) {
    const settings = await prisma.setting.findMany({
      where: { group: { in: ['general', 'homepage', 'seo', 'social', 'contact', 'shipping'] } },
    });
    const map = settings.reduce((acc: Record<string, string>, s) => {
      acc[s.key] = s.value || '';
      return acc;
    }, {});
    return sendSuccess(res, map, 'Settings fetched');
  }

  async getByGroup(req: Request, res: Response) {
    const { group } = req.params;
    const settings = await prisma.setting.findMany({ where: { group } });
    return sendSuccess(res, settings, 'Settings fetched');
  }

  async getAllSettings(req: Request, res: Response) {
    const settings = await prisma.setting.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
    return sendSuccess(res, settings, 'All settings');
  }

  async upsertSetting(req: Request, res: Response) {
    const { key, value, group, type, label } = req.body;
    const setting = await prisma.setting.upsert({
      where: { key },
      create: { key, value, group, type, label },
      update: { value },
    });
    return sendSuccess(res, setting, 'Setting saved');
  }

  async upsertBulk(req: Request, res: Response) {
    const { settings } = req.body;
    await prisma.$transaction(
      (settings as { key: string; value: string }[]).map(s =>
        prisma.setting.upsert({
          where: { key: s.key },
          create: { key: s.key, value: s.value },
          update: { value: s.value },
        })
      )
    );
    return sendSuccess(res, null, 'Settings saved');
  }
}

export const settingsController = new SettingsController();
