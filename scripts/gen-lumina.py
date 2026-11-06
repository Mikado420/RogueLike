#!/usr/bin/env python3
"""結晶の街ルミナのマップを組み立てる（data/maps/lumina.json と data/areas.json の NPC の位置）。

道・広場・建物・小物をここで決めて書き出す。手で 40×40 の文字を打つと崩れやすいので、配置はこのスクリプトを直す。
使い方: python3 scripts/gen-lumina.py
"""
import json
import math
import os
from collections import deque

ROOT = os.path.join(os.path.dirname(__file__), '..')
W = H = 40
grid = [['g'] * W for _ in range(H)]


def put(i, j, ch):
    if 0 <= i < W and 0 <= j < H:
        grid[j][i] = ch


def fill(x0, y0, x1, y1, ch):
    for j in range(y0, y1 + 1):
        for i in range(x0, x1 + 1):
            put(i, j, ch)


# 外壁と東の門（出口は rect [39,18,40,22]）
for k in range(W):
    put(k, 0, '#'); put(k, H - 1, '#'); put(0, k, '#'); put(W - 1, k, '#')

# 道（石畳）
fill(26, 18, 39, 21, 'r')   # 東の大通り → 門
fill(19, 7, 21, 13, 'r')    # 北 → 塔
fill(19, 27, 21, 37, 'r')   # 南
fill(2, 19, 13, 21, 'r')    # 西
fill(2, 16, 17, 17, 'r')    # 北西の店の並び（道具屋・倉庫の前）
fill(24, 15, 38, 16, 'r')   # 北東の店の並び（鍛冶屋・食堂の前）
fill(17, 5, 18, 13, 'r')    # 礼拝堂の前
fill(10, 22, 12, 30, 'r')   # 南西の小道
fill(22, 26, 24, 33, 'r')   # 訓練場の入口

# 中央の広場（円）
for j in range(H):
    for i in range(W):
        if math.hypot(i + 0.5 - 20.5, j + 0.5 - 20.5) <= 6.6:
            put(i, j, ',')

# 塔（今のまま）
fill(16, 1, 23, 4, 'X')
fill(17, 5, 22, 6, 't')

# 訓練場（土の庭と柵）
fill(25, 27, 33, 34, 'y')
for i in range(25, 34):
    put(i, 26, 'e'); put(i, 35, 'e')
for j in range(27, 35):
    put(34, j, 'E')
for j in (27, 33, 34):
    put(25, j, 'E')
for (i, j) in [(28, 29), (30, 31), (32, 29), (28, 32)]:
    put(i, j, 'd')

# 建物（床は通れない。扉は南 s か東 e）
buildings = [
    dict(x=9, y=11, w=6, h=5, kind='shop', door=dict(side='s', at=3), roof='#3f8a5a', wall='#e8dcc0', sign='shop', awning='#d8574a', chimney=False),
    dict(x=2, y=10, w=5, h=6, kind='storage', door=dict(side='s', at=2), roof='#7a5a3a', wall='#a07a50', sign='storage', height=40),
    dict(x=11, y=4, w=5, h=6, kind='chapel', door=dict(side='e', at=3), roof='#4a6aa8', wall='#f0ece0', sign='chapel', height=46),
    dict(x=25, y=10, w=6, h=5, kind='smith', door=dict(side='s', at=2), roof='#4a4a58', wall='#8a7a6a', sign='smith', chimney=True),
    dict(x=32, y=9, w=6, h=6, kind='inn', door=dict(side='s', at=2), roof='#c8743a', wall='#e8d8b8', sign='cook', awning='#e8b84a', chimney=True),
    dict(x=3, y=24, w=6, h=5, kind='guild', door=dict(side='e', at=2), roof='#a83a3a', wall='#e0d0b0', sign='guild', height=40),
    dict(x=26, y=3, w=5, h=4, kind='house', door=dict(side='s', at=2), roof='#a84a3a', wall='#e8dcc0', chimney=True),
    dict(x=33, y=3, w=4, h=4, kind='house', door=dict(side='s', at=1), roof='#4a6a9a', wall='#e0d4b8'),
    dict(x=3, y=31, w=5, h=4, kind='house', door=dict(side='e', at=2), roof='#4a6a9a', wall='#e8dcc0', chimney=True),
    dict(x=13, y=24, w=4, h=4, kind='house', door=dict(side='s', at=1), roof='#a84a3a', wall='#e0d4b8'),
    dict(x=13, y=31, w=5, h=4, kind='house', door=dict(side='e', at=2), roof='#5a8a4a', wall='#e8dcc0', chimney=True),
    dict(x=35, y=26, w=3, h=4, kind='house', door=dict(side='s', at=1), roof='#7a5a3a', wall='#a07a50'),
    dict(x=26, y=36, w=6, h=2, kind='house', door=dict(side='s', at=2), roof='#4a6a9a', wall='#e8dcc0'),
    dict(x=3, y=3, w=5, h=4, kind='house', door=dict(side='s', at=2), roof='#5a8a4a', wall='#e0d4b8', chimney=True),
]
for b in buildings:
    fill(b['x'], b['y'], b['x'] + b['w'] - 1, b['y'] + b['h'] - 1, 'B')
    # 扉の前は道にする
    d = b['door']
    if d['side'] == 's':
        i, j = b['x'] + d['at'], b['y'] + b['h']
    else:
        i, j = b['x'] + b['w'], b['y'] + d['at']
    if grid[j][i] in 'gf':
        put(i, j, 'r')

# 中央の大結晶・街灯・花壇・ベンチ
put(20, 20, 'C')
for (i, j) in [(15, 17), (25, 17), (15, 23), (25, 23)]:
    put(i, j, 'L')
for (i, j) in [(17, 15), (23, 15), (14, 20), (17, 26), (23, 26)]:
    if grid[j][i] in ',g':
        put(i, j, 'f')
for (i, j) in [(18, 25), (22, 25)]:
    put(i, j, 'n')

# 店のまわりの小物
for (i, j, ch) in [
    (8, 15, 'x'), (8, 14, 'b'), (7, 16, 'x'),          # 倉庫の木箱と樽
    (15, 15, 'm'), (16, 15, 'b'),                       # 道具屋の露店
    (30, 15, 'a'), (31, 14, 'b'), (31, 15, 'x'),        # 鍛冶屋の金床
    (32, 16, 'n'), (37, 16, 'n'),                       # 食堂の前のベンチ
    (9, 23, 'w'),                                       # 井戸
    (24, 9, 'b'), (24, 8, 'x'),
]:
    put(i, j, ch)

# 木と茂み（緑のところに散らす。決まった並びにして毎回同じにする）
trees = [(2, 7), (8, 2), (10, 2), (24, 2), (37, 2), (31, 8), (38, 8), (2, 22), (2, 29), (2, 36), (9, 36), (17, 37),
         (23, 37), (34, 37), (37, 33), (37, 23), (8, 30), (24, 23), (16, 28), (36, 12), (13, 2)]
for (i, j) in trees:
    if grid[j][i] == 'g':
        put(i, j, 'T')
bushes = [(7, 8), (24, 5), (9, 29), (17, 30), (31, 24), (36, 21), (16, 12), (24, 12), (3, 37), (37, 30)]
for (i, j) in bushes:
    if grid[j][i] == 'g':
        put(i, j, 'h')

legend = {
    'g': {'tile': 'town_grass', 'solid': False},
    'r': {'tile': 'road', 'solid': False},
    ',': {'tile': 'plaza', 'solid': False},
    'y': {'tile': 'yard', 'solid': False},
    'B': {'tile': 'road', 'solid': True},
    '#': {'tile': 'stone', 'solid': True, 'sprite': 'town_wall'},
    'X': {'tile': 'tower', 'solid': True, 'sprite': 'tower_wall'},
    't': {'tile': 'tower', 'solid': False},
    'C': {'tile': 'plaza', 'solid': True, 'sprite': 'crystal_big'},
    'L': {'tile': 'plaza', 'solid': True, 'sprite': 'lamp'},
    'T': {'tile': 'town_grass', 'solid': True, 'sprite': 'tree'},
    'h': {'tile': 'town_grass', 'solid': True, 'sprite': 'town_bush'},
    'f': {'tile': 'town_grass', 'solid': True, 'sprite': 'flowers'},
    'n': {'tile': 'plaza', 'solid': True, 'sprite': 'bench'},
    'x': {'tile': 'road', 'solid': True, 'sprite': 'crate'},
    'b': {'tile': 'road', 'solid': True, 'sprite': 'barrel'},
    'm': {'tile': 'road', 'solid': True, 'sprite': 'stall'},
    'a': {'tile': 'road', 'solid': True, 'sprite': 'anvil'},
    'w': {'tile': 'road', 'solid': True, 'sprite': 'well'},
    'e': {'tile': 'yard', 'solid': True, 'sprite': 'fence'},
    'd': {'tile': 'yard', 'solid': True, 'sprite': 'dummy'},
    'E': {'tile': 'yard', 'solid': True, 'sprite': 'fence_y'},
}

# NPC は自分の店の扉の前に
npcs = [
    ('merchant', 12.5, 16.6), ('keeper', 4.5, 16.6), ('priest', 16.6, 7.5), ('smith', 27.5, 15.6),
    ('cook', 34.5, 15.6), ('base_keeper', 9.6, 26.5), ('weapon_master', 23.5, 29.5),
    ('board', 17.5, 22.5), ('portal', 24.0, 20.5), ('memory', 16.5, 19.0), ('tower_gate', 20.5, 7.5),
]
spawn = (20.5, 24.5)
east = (37.5, 19.5)


def walkable(i, j):
    return 0 <= i < W and 0 <= j < H and legend[grid[j][i]]['solid'] is False


# 確かめる：出入口・NPC の足元が歩けて、街の中心からたどり着ける
seen = set()
q = deque([(int(spawn[0]), int(spawn[1]))])
while q:
    i, j = q.popleft()
    if (i, j) in seen or not walkable(i, j):
        continue
    seen.add((i, j))
    q.extend([(i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)])
for name, x, y in npcs + [('east', *east), ('spawn', *spawn)]:
    assert (int(x), int(y)) in seen, f'{name} ({x},{y}) に歩いて行けない'
for k in range(18, 22):
    assert grid[k][39] == 'r' and walkable(38, k), '東の門（出口）が開いていない'

rows = [''.join(r) for r in grid]
out = {'legend': legend, 'rows': rows, 'buildings': buildings, 'terrain': 'town'}
with open(os.path.join(ROOT, 'data/maps/lumina.json'), 'w') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write('\n')

areas_path = os.path.join(ROOT, 'data/areas.json')
areas = json.load(open(areas_path))
by = {n['npc']: n for n in areas['lumina']['npcs']}
for name, x, y in npcs:
    by[name]['x'] = x
    by[name]['y'] = y
areas['lumina']['playerSpawn'] = {'x': spawn[0], 'y': spawn[1]}
with open(areas_path, 'w') as f:
    json.dump(areas, f, ensure_ascii=False, indent=1)
    f.write('\n')
print('\n'.join(rows))
