-- ============================================================================
-- Pykachu Go — Supabase Seed Data ONLY (All Datasets)
-- Project ID: gapgwryagjpwpyxkcxck
-- Run this AFTER schema.sql in Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

-- 1. Seed Game Metadata
INSERT INTO public.game_meta (id, epoch, catalog_version)
VALUES (1, 1, 1)
ON CONFLICT (id) DO NOTHING;

-- 2. Seed Admins (from admin.json)
INSERT INTO public.admins (email, password)
VALUES
  ('admin@pykachu.go', '123'),
  ('pranavpaunikar16@gmail.com', '123')
ON CONFLICT (email) DO UPDATE SET
  password = EXCLUDED.password,
  updated_at = NOW();

-- 3. Seed Game Config (from config.json)
INSERT INTO public.game_config (id, config)
VALUES (
  1,
  $cfg${
    "languages": [
      { "value": "PYTHON", "label": "PYTHON", "icon": "assets/img/python.png" },
      { "value": "CPP", "label": "C++", "icon": "assets/img/cpp.svg" }
    ],
    "missionTypes": [
      { "value": "GRASS", "label": "GRASS", "icon": "assets/img/grass.png" },
      { "value": "FIRE", "label": "FIRE", "icon": "assets/img/fire.png" },
      { "value": "WATER", "label": "WATER", "icon": "assets/img/water.png" },
      { "value": "GROUND", "label": "GROUND", "icon": "assets/img/ground.png" },
      { "value": "GHOST", "label": "GHOST", "icon": "assets/img/ghost.png" },
      { "value": "FAIRY", "label": "FAIRY", "icon": "assets/img/fairy.png" },
      { "value": "PIKACHU", "label": "PIKACHU", "icon": "assets/img/pikachu.png" }
    ],
    "missionGroups": [
      {
        "label": "LEVEL 1: ELEMENTAL",
        "level": "L1",
        "labelClass": "text-blue-400",
        "missions": [
          { "value": "L1_GRASS", "label": "GRASS SECTOR", "icon": "assets/img/grass.png" },
          { "value": "L1_FIRE", "label": "FIRE SECTOR", "icon": "assets/img/fire.png" },
          { "value": "L1_WATER", "label": "WATER SECTOR", "icon": "assets/img/water.png" },
          { "value": "L1_GROUND", "label": "GROUND SECTOR", "icon": "assets/img/ground.png" }
        ]
      },
      {
        "label": "LEVEL 2: ELITE",
        "level": "L2",
        "labelClass": "text-yellow-500",
        "missions": [
          { "value": "L2_GHOST", "label": "GHOST ASCENT", "icon": "assets/img/ghost.png" },
          { "value": "L2_FAIRY", "label": "FAIRY STRIKE", "icon": "assets/img/fairy.png" }
        ]
      },
      {
        "label": "LEVEL 3: ULTIMATE",
        "level": "L3",
        "labelClass": "text-red-500",
        "missions": [
          { "value": "L3_PIKACHU", "label": "PIKACHU GO", "icon": "assets/img/pikachu.png" }
        ]
      }
    ]
  }$cfg$::JSONB
)
ON CONFLICT (id) DO UPDATE SET
  config = EXCLUDED.config,
  updated_at = NOW();

-- 4. Seed Memes (from meme.json)
INSERT INTO public.memes (memeid, ytlink, starttime, endtime)
VALUES
  ('M01', 'https://youtube.com/shorts/imZI0iVzSsg?si=jUofRCxm5j8b1Spq', 0, 0),
  ('M02', 'https://youtube.com/shorts/EOldTdkTgL0?si=iPXQE-aWWuskql2P', 0, 0)
ON CONFLICT (memeid) DO UPDATE SET
  ytlink = EXCLUDED.ytlink,
  starttime = EXCLUDED.starttime,
  endtime = EXCLUDED.endtime,
  updated_at = NOW();

-- 5. Seed Teams (from teams.json: T001 - T040)
INSERT INTO public.teams (tid, team, email, emails, security_key, team_members)
VALUES
  ('T001', 'PRANAV', 'pranav@pykachu.go', ARRAY['pranav@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T002', 'TEAM02', 'team02@pykachu.go', ARRAY['team02@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T003', 'TEAM03', 'team03@pykachu.go', ARRAY['team03@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T004', 'TEAM04', 'team04@pykachu.go', ARRAY['team04@pykachu.go'], '321', ARRAY['A', 'B', 'C', 'D']),
  ('T005', 'TEAM05', 'team05@pykachu.go', ARRAY['team05@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T006', 'TEAM06', 'team06@pykachu.go', ARRAY['team06@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T007', 'TEAM07', 'team07@pykachu.go', ARRAY['team07@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T008', 'TEAM08', 'team08@pykachu.go', ARRAY['team08@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T009', 'TEAM09', 'team09@pykachu.go', ARRAY['team09@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T010', 'TEAM10', 'team10@pykachu.go', ARRAY['team10@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T011', 'TEAM11', 'team11@pykachu.go', ARRAY['team11@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T012', 'TEAM12', 'team12@pykachu.go', ARRAY['team12@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T013', 'TEAM13', 'team13@pykachu.go', ARRAY['team13@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T014', 'TEAM14', 'team14@pykachu.go', ARRAY['team14@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T015', 'TEAM15', 'team15@pykachu.go', ARRAY['team15@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T016', 'TEAM16', 'team16@pykachu.go', ARRAY['team16@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T017', 'TEAM17', 'team17@pykachu.go', ARRAY['team17@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T018', 'TEAM18', 'team18@pykachu.go', ARRAY['team18@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T019', 'TEAM19', 'team19@pykachu.go', ARRAY['team19@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T020', 'TEAM20', 'team20@pykachu.go', ARRAY['team20@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T021', 'TEAM21', 'team21@pykachu.go', ARRAY['team21@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T022', 'TEAM22', 'team22@pykachu.go', ARRAY['team22@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T023', 'TEAM23', 'team23@pykachu.go', ARRAY['team23@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T024', 'TEAM24', 'team24@pykachu.go', ARRAY['team24@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T025', 'TEAM25', 'team25@pykachu.go', ARRAY['team25@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T026', 'TEAM26', 'team26@pykachu.go', ARRAY['team26@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T027', 'TEAM27', 'team27@pykachu.go', ARRAY['team27@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T028', 'TEAM28', 'team28@pykachu.go', ARRAY['team28@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T029', 'TEAM29', 'team29@pykachu.go', ARRAY['team29@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T030', 'TEAM30', 'team30@pykachu.go', ARRAY['team30@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T031', 'TEAM31', 'team31@pykachu.go', ARRAY['team31@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T032', 'TEAM32', 'team32@pykachu.go', ARRAY['team32@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T033', 'TEAM33', 'team33@pykachu.go', ARRAY['team33@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T034', 'TEAM34', 'team34@pykachu.go', ARRAY['team34@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T035', 'TEAM35', 'team35@pykachu.go', ARRAY['team35@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T036', 'TEAM36', 'team36@pykachu.go', ARRAY['team36@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T037', 'TEAM37', 'team37@pykachu.go', ARRAY['team37@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T038', 'TEAM38', 'team38@pykachu.go', ARRAY['team38@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T039', 'TEAM39', 'team39@pykachu.go', ARRAY['team39@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D']),
  ('T040', 'TEAM40', 'team40@pykachu.go', ARRAY['team40@pykachu.go'], '123', ARRAY['A', 'B', 'C', 'D'])
ON CONFLICT (tid) DO UPDATE SET
  team = EXCLUDED.team,
  email = EXCLUDED.email,
  emails = EXCLUDED.emails,
  security_key = EXCLUDED.security_key,
  team_members = EXCLUDED.team_members,
  updated_at = NOW();

-- 6. Seed Puzzles (from puzzle.json: IDs 1 - 7)
INSERT INTO public.puzzles (
  id, linkid, badge_id, question_python, question_cpp, answer,
  next_puzzle_id, start_code, requires_start_code, location_clue,
  level, points, hint, has_hint, hint_penalty, pokemon_id, pokemon_name
)
VALUES
  (
    1, 'XG01', 1,
    $py1$def func(n):
    return n * 3 + 5

x = func(4)
y = func(2)
z = x - y * 2
print(z)$py1$,
    $cpp1$#include <iostream>
using namespace std;

int func(int n) {
    return n * 3 + 5;
}

int main() {
    int x = func(4);
    int y = func(2);
    int z = x - y * 2;
    cout << z << endl;
    return 0;
}$cpp1$,
    '-5', ARRAY[2, 6], 'START', TRUE, 'CSE entrance - openspace',
    1, 10, 'BODMAS', TRUE, 60, 39, 'Jigglypuff'
  ),
  (
    2, 'XG02', NULL,
    $py2$def func(n):
    return n * 2 + 3

x = func(5)
y = func(3)
z = x - y
print(z)$py2$,
    $cpp2$#include <iostream>
using namespace std;

int func(int n) {
    return n * 2 + 3;
}

int main() {
    int x = func(5);
    int y = func(3);
    int z = x - y;
    cout << z << endl;
    return 0;
}$cpp2$,
    '4', ARRAY[3], NULL, FALSE, 'Mechanical Workshop',
    1, 10, 'Simple arithmetic', TRUE, 60, 7, 'Squirtle'
  ),
  (
    3, 'XG03', NULL,
    $py3$def func(n):
    return n ** 2

x = func(3)
y = func(2)
z = x + y
print(z)$py3$,
    $cpp3$#include <iostream>
using namespace std;

int func(int n) {
    return n * n;
}

int main() {
    int x = func(3);
    int y = func(2);
    int z = x + y;
    cout << z << endl;
    return 0;
}$cpp3$,
    '13', ARRAY[4], NULL, FALSE, 'Back Stage',
    1, 10, 'Power of 2', TRUE, 60, 4, 'Charmander'
  ),
  (
    4, 'XG04', 3,
    $py4$def func(n):
    return n * 4 - 1

x = func(2)
y = func(3)
z = y - x
print(z)$py4$,
    $cpp4$#include <iostream>
using namespace std;

int func(int n) {
    return n * 4 - 1;
}

int main() {
    int x = func(2);
    int y = func(3);
    int z = y - x;
    cout << z << endl;
    return 0;
}$cpp4$,
    '4', ARRAY[5], 'GRASS', TRUE, 'M215 back door',
    1, 10, 'Linear function: work out func(2) and func(3) first, then subtract.', TRUE, 60, 27, 'Sandshrew'
  ),
  (
    5, 'XG05', NULL,
    $py5$def mystery(a, b):
    if a > b:
        return a * 2 - b
    else:
        return b * 2 - a

x = mystery(5, 3)
y = mystery(4, 7)
z = x + y
print(z)$py5$,
    $cpp5$#include <iostream>
using namespace std;

int mystery(int a, int b) {
    if (a > b)
        return a * 2 - b;
    else
        return b * 2 - a;
}

int main() {
    int x = mystery(5, 3);
    int y = mystery(4, 7);
    int z = x + y;
    cout << z << endl;
    return 0;
}$cpp5$,
    '17', ARRAY[6], NULL, FALSE, 'AIML Entrance',
    2, 20, 'Conditional logic', TRUE, 60, 6, 'Charizard'
  ),
  (
    6, 'XG06', NULL,
    $py6$def transform(n):
    total = 0
    for i in range(1, n+1):
        total += i * 2
    return total

result = transform(4) + transform(3)
print(result)$py6$,
    $cpp6$#include <iostream>
using namespace std;

int transform(int n) {
    int total = 0;
    for (int i = 1; i <= n; i++)
        total += i * 2;
    return total;
}

int main() {
    int result = transform(4) + transform(3);
    cout << result << endl;
    return 0;
}$cpp6$,
    '32', ARRAY[7, 3], NULL, FALSE, 'M308',
    2, 20, 'Sum of series', TRUE, 60, 658, 'Greninja'
  ),
  (
    7, 'XG07', NULL,
    $py7$def ultimate(x, y, z):
    return (x + y) * z - (x * y)

result = ultimate(3, 4, 5)
print(result)$py7$,
    $cpp7$#include <iostream>
using namespace std;

int ultimate(int x, int y, int z) {
    return (x + y) * z - (x * y);
}

int main() {
    int result = ultimate(3, 4, 5);
    cout << result << endl;
    return 0;
}$cpp7$,
    '23', '{}'::INTEGER[], NULL, FALSE, 'G007',
    3, 30, NULL, FALSE, 60, 25, 'Pikachu'
  )
ON CONFLICT (id) DO UPDATE SET
  linkid = EXCLUDED.linkid,
  badge_id = EXCLUDED.badge_id,
  question_python = EXCLUDED.question_python,
  question_cpp = EXCLUDED.question_cpp,
  answer = EXCLUDED.answer,
  next_puzzle_id = EXCLUDED.next_puzzle_id,
  start_code = EXCLUDED.start_code,
  requires_start_code = EXCLUDED.requires_start_code,
  location_clue = EXCLUDED.location_clue,
  level = EXCLUDED.level,
  points = EXCLUDED.points,
  hint = EXCLUDED.hint,
  has_hint = EXCLUDED.has_hint,
  hint_penalty = EXCLUDED.hint_penalty,
  pokemon_id = EXCLUDED.pokemon_id,
  pokemon_name = EXCLUDED.pokemon_name,
  updated_at = NOW();
