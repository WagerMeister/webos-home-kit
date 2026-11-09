#!/bin/bash

# This script does some early-boot initialization of rooted webOS devices. It's
# meant to be copied over to suitable path (eg. start-devmode.sh) to keep it
# safe from accidental homebrew channel app removal.

# Local diagnostic extension: bounded, best-effort phase journal only.
# Never clears the guard, reruns init, changes a boot choice, or starts a daemon.
wb_trace() (
    umask 077
    wb_dir=/var/lib/webosbrew/startup-trace
    wb_log="$wb_dir/phases.log"
    mkdir -p "$wb_dir" || exit 0
    wb_size=0
    [ ! -f "$wb_log" ] || wb_size=$(wc -c < "$wb_log")
    if [ "$wb_size" -ge 65536 ]; then
        mv -f "$wb_log" "$wb_dir/phases.previous.log" || exit 0
    fi
    read wb_up wb_idle < /proc/uptime || wb_up=unknown
    read wb_boot < /proc/sys/kernel/random/boot_id || wb_boot=unknown
    wb_flag=absent
    [ ! -e /var/luna/preferences/webosbrew_failsafe ] || wb_flag=present
    printf 'v=1 boot=%s uptime=%s pid=%s ppid=%s phase=%s flag=%s detail=%s\n' \
        "$wb_boot" "$wb_up" "$$" "$PPID" "$1" "$wb_flag" "${2:-}" >> "$wb_log" || exit 0
    case "$1" in
        enter|failsafe_enter|hooks_begin|normal_complete|exit) sync -f "$wb_log" ;;
    esac
    exit 0
) 2>/dev/null

# Ensure that startup script runs only once per boot
once=/tmp/webosbrew_startup
exec 200>"${once}.lock"

if ! flock -x -n 200; then
    echo "[!] Startup script already running" >&2
    exit 1
fi

trap 'wb_trace exit "$?"; rm -f "${once}.lock"' EXIT
wb_trace enter

if test -f "${once}"; then
    wb_trace already_finished
    echo "[!] Startup script finished already" >&2
    exit 2
fi

touch "${once}"
wb_trace once_created

# Use default directory if SERVICE_DIR is not provided.
SERVICE_DIR="${SERVICE_DIR-/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service}"

if [[ -e /var/luna/preferences/webosbrew_failsafe ]]; then
    wb_trace failsafe_enter
    # In case a reboot occured during last startup - open an emergency telnet
    # server and nag user to actually fix this. (since further reboots could
    # lead to devmode removal, etc...)

    "${SERVICE_DIR}/bin/telnetd" -l /bin/sh
    wb_trace failsafe_telnet "$?"
    sleep 1

    luna-send -a webosbrew -f -n 1 luna://com.webos.notification/createToast '{"sourceId":"webosbrew","message": "<b>Failsafe mode!</b><br/>A crash has occured during startup. Fix any causes and reboot."}'
    wb_trace failsafe_toast "$?"
    sleep 15;
    rm -rf /var/luna/preferences/webosbrew_failsafe
    sync -f /var/luna/preferences
    luna-send -a com.webos.service.secondscreen.gateway -f -n 1 luna://com.webos.notification/createAlert '{"sourceId":"webosbrew","message":"<b>Homebrew Channel</b> - Failsafe mode<br />A crash has occured during previous startup - root-related system customizations have been temporarily disabled.<br /><br /> System should go back to normal after a reboot.<br />Would you like to reboot now?","buttons":[{"label":"Reboot now","onclick":"luna://com.webos.service.sleep/shutdown/machineReboot","params":{"reason":"remoteKey"}},{"label":"Reboot later"}]}'
else
    wb_trace normal_begin
    # Set a failsafe flag and sync filesystem to make sure it actually gets
    # tripped...
    touch /var/luna/preferences/webosbrew_failsafe
    sync -f /var/luna/preferences/webosbrew_failsafe
    wb_trace normal_guard_synced "$?"
    sleep 2

    # Close fds to avoid leaking Luna socket
    fds="$(ls -1 "/proc/$$/fd")"
    for fd in $fds; do
        case $fd in
        # Don't close stdin, stdout, stderr, or lock
        0|1|2|200) ;;
        *) eval "exec $fd>&-" ;;
        esac
    done

    wb_trace descriptors_closed
    # Reset devmode reboot counter
    rm -f /var/luna/preferences/dc*

    # Block software update servers
    if [[ -e /var/luna/preferences/webosbrew_block_updates ]]; then
        cp /etc/hosts /tmp/hosts
        mount --bind /tmp/hosts /etc/hosts

        echo '' >> /etc/hosts
        echo '# This file is dynamically regenerated on boot by webosbrew startup script' >> /etc/hosts
        echo '127.0.0.1 snu.lge.com su-dev.lge.com su.lge.com su-ssl.lge.com' >> /etc/hosts
        echo '::1 snu.lge.com su-dev.lge.com su.lge.com su-ssl.lge.com' >> /etc/hosts
    fi

    wb_trace hosts_ready
    # Start root telnet server
    if [[ ! -e /var/luna/preferences/webosbrew_telnet_disabled ]]; then
        "${SERVICE_DIR}/bin/telnetd" -l /bin/sh 200>&-
    fi

    # Start sshd
    if [[ -e /var/luna/preferences/webosbrew_sshd_enabled ]]; then
        mkdir -p /var/lib/webosbrew/sshd
        "${SERVICE_DIR}/bin/dropbear" -R 200>&-
    fi

    printf "\033[1;91mNEVER EVER OVERWRITE SYSTEM PARTITIONS LIKE KERNEL, ROOTFS, TVSERVICE.\nYour TV will be bricked, guaranteed! See https://rootmy.tv/warning for more info.\033[0m\n" > /tmp/motd
    mount --bind /tmp/motd /etc/motd

    # Set placeholder root password (alpine) unless someone has already
    # provisioned their ssh authorized keys
    if [ ! -f /home/root/.ssh/authorized_keys ]; then
        sed -r 's/root:.?:/root:xGVw8H4GqkKg6:/' /etc/shadow > /tmp/shadow
        chmod 400 /tmp/shadow
        mount --bind /tmp/shadow /etc/shadow

        # Enable root account (only required on old webOS versions)
        if grep -q 'root:\*:' /etc/passwd; then
            sed 's/root:\*:/root:x:/' /etc/passwd > /tmp/passwd
            chmod 444 /tmp/passwd
            mount --bind /tmp/passwd /etc/passwd
        fi

        echo '' >> /tmp/motd
        echo ' /!\ Your system is using a default password.' >> /tmp/motd
        echo ' /!\ Insert SSH public key into /home/root/.ssh/authorized_keys and perform a reboot to remove this warning.' >> /tmp/motd
        echo '' >> /tmp/motd
    else
        # Cleanup in case someone accidentally uploads a file with 777
        # permissions
        chmod 600 /home/root/.ssh/authorized_keys
        chown 0:0 /home/root/.ssh/authorized_keys
    fi

    wb_trace access_ready
    # Do our best to neuter telemetry
    mkdir -p /tmp/.unwritable
    for path in /tmp/rdxd /tmp/uploadd /var/spool/rdxd /var/spool/uploadd/pending /var/spool/uploadd/uploaded; do
        mkdir -p $path
        mount -o bind,ro /tmp/.unwritable $path

        # Some older mount (webOS 3.x) does not support direct ro bind mount, so
        # this needs to be remounted after initial bind...
        mount -o bind,remount,ro /tmp/.unwritable $path
    done

    # Deprecate old path
    if [[ -d /home/root/unwritable ]]; then
      chattr -i /home/root/unwritable
      rm -rf /home/root/unwritable
    fi

    wb_trace telemetry_ready
    # Automatically elevate Homebrew Channel service
    elevate_script="${SERVICE_DIR}/elevate-service"
    if [[ -z "${SKIP_ELEVATION}" && -x "${elevate_script}" ]]; then
        wb_trace elevate_begin
        "${elevate_script}"
        wb_trace elevate_end "$?"
    fi

    # Run user startup hooks
    mkdir -p /var/lib/webosbrew/init.d
    wb_trace hooks_begin
    run-parts /var/lib/webosbrew/init.d 200>&-
    wb_hooks_rc=$?
    wb_trace hooks_end "$wb_hooks_rc"

    wb_trace guard_delay_begin
    # Keep the original grace; only a confirmed native clean power-off
    # after successful hooks may finish it early. Errors retain the guard.
    if [ "$wb_hooks_rc" -eq 0 ] && [ -f /var/lib/webosbrew/startup-trace/grace-poweroff.py ]; then
        /usr/bin/python /var/lib/webosbrew/startup-trace/grace-poweroff.py --hooks-ok 200>&-
        wb_watch_rc=$?
        if [ "$wb_watch_rc" -ne 0 ]; then
            wb_trace grace_fallback "$wb_watch_rc"
            sleep 10
        fi
    else
        sleep 10
    fi
    rm -rf /var/luna/preferences/webosbrew_failsafe
    sync -f /var/luna/preferences
    wb_trace_status=$?
    wb_trace normal_complete "$wb_trace_status"
    exit "$wb_trace_status"
fi
