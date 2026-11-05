import { OfflineServices, txt, type OnlineServices } from '../../../shared/src';
import { btn, h } from './dom';
import type { Menu } from './menu';

/** オンライン用の窓口。オフラインでは押せない */
export function registerOnlineTab(menu: Menu, services: OnlineServices = OfflineServices) {
  menu.extraTabs.push({
    id: 'online',
    label: txt('menu.online'),
    render: (el) => {
      const online = services.status().online;
      const list = h('div', 'online-list');
      for (const k of ['party', 'chat', 'market', 'rescue', 'builds'] as const) {
        const row = h('div', 'online-row');
        const b = btn(online ? txt('online.open') : txt('online.offline'), () => {}, 'mini');
        b.disabled = !online;
        row.append(h('span', 'name', txt(`online.${k}`)), online ? b : h('span', 'online-state', txt('online.offline')));
        list.append(row);
      }
      el.append(list);
    },
  });
}
