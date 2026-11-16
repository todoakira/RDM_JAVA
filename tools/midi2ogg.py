# MIDI → OGG 변환 (브라우저는 MIDI 를 직접 재생하지 못한다).
# libfluidsynth(시스템 라이브러리)와 GM 사운드폰트로 파일 렌더링한 뒤 ffmpeg 로 OGG 로 줄인다.
# 사용: python3 tools/midi2ogg.py <mid 폴더> <출력 폴더> [사운드폰트]
import ctypes, sys, os, subprocess, tempfile
lib = ctypes.CDLL('libfluidsynth.so.3')
lib.new_fluid_settings.restype = ctypes.c_void_p
lib.new_fluid_synth.restype = ctypes.c_void_p; lib.new_fluid_synth.argtypes = [ctypes.c_void_p]
lib.new_fluid_player.restype = ctypes.c_void_p; lib.new_fluid_player.argtypes = [ctypes.c_void_p]
lib.new_fluid_file_renderer.restype = ctypes.c_void_p; lib.new_fluid_file_renderer.argtypes = [ctypes.c_void_p]
for f in ['fluid_settings_setstr']: getattr(lib, f).argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
lib.fluid_settings_setnum.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_double]
lib.fluid_synth_sfload.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
lib.fluid_player_add.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lib.fluid_player_play.argtypes = [ctypes.c_void_p]
lib.fluid_player_get_status.argtypes = [ctypes.c_void_p]
lib.fluid_file_renderer_process_block.argtypes = [ctypes.c_void_p]
for f in ['delete_fluid_file_renderer', 'delete_fluid_player', 'delete_fluid_synth', 'delete_fluid_settings']: getattr(lib, f).argtypes = [ctypes.c_void_p]
src, out = sys.argv[1], sys.argv[2]
sf = sys.argv[3] if len(sys.argv) > 3 else '/usr/share/sounds/sf2/TimGM6mb.sf2'
os.makedirs(out, exist_ok=True)
for name in sorted(os.listdir(src)):
    if not name.lower().endswith('.mid'): continue
    wav = os.path.join(tempfile.gettempdir(), name + '.wav')
    st = lib.new_fluid_settings()
    lib.fluid_settings_setstr(st, b'audio.file.name', wav.encode())
    lib.fluid_settings_setstr(st, b'player.timing-source', b'sample')
    lib.fluid_settings_setnum(st, b'synth.sample-rate', 44100.0)
    sy = lib.new_fluid_synth(st); lib.fluid_synth_sfload(sy, sf.encode(), 1)
    pl = lib.new_fluid_player(sy); lib.fluid_player_add(pl, os.path.join(src, name).encode()); lib.fluid_player_play(pl)
    rd = lib.new_fluid_file_renderer(sy)
    while lib.fluid_player_get_status(pl) == 1:
        if lib.fluid_file_renderer_process_block(rd) != 0: break
    lib.delete_fluid_file_renderer(rd); lib.delete_fluid_player(pl); lib.delete_fluid_synth(sy); lib.delete_fluid_settings(st)
    dst = os.path.join(out, name.lower()[:-4] + '.ogg')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'libvorbis', '-q:a', '0', dst], check=True)
    os.remove(wav); print(name, os.path.getsize(dst))
