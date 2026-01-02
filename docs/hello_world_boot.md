# Cross-platform "Hello World" boot options (USB)

This document outlines the safest minimal approaches to show a "Hello World" message during boot without touching an installed OS. The goal is to run only when the user explicitly selects the USB device from the firmware boot menu; nothing here attempts to persist into Windows, Ubuntu, or macOS startups.

## Key constraints
- Modern Windows, Ubuntu, and macOS all use UEFI boot flows. They will not execute code from a removable drive unless the firmware is directed to boot that drive first.
- Truly hooking into an existing OS boot without writing to its disk is not reliable or portable and generally requires invasive bootkits. This guide avoids that entirely.
- The approaches below keep everything on the USB drive, use read-only media when possible, and do not modify internal disks.

## Option A: Minimal UEFI application (recommended)
A standalone UEFI application prints text directly using firmware services and works on any x86_64 machine that honors removable media boot (including Windows PCs, Ubuntu-capable hardware, and Intel Macs).

**Build outline**
1. Install a UEFI SDK (e.g., `gnu-efi`) in a Linux build environment.
2. Create `hello.c`:
   ```c
   #include <efi.h>
   #include <efilib.h>

   EFI_STATUS efi_main(EFI_HANDLE image, EFI_SYSTEM_TABLE *systab) {
     InitializeLib(image, systab);
     Print(L"Hello World from UEFI!\n");
     // Wait for a key so the user sees the message
     WaitForSingleEvent(ST->ConIn->WaitForKey, 0);
     return EFI_SUCCESS;
   }
   ```
3. Build to `BOOTX64.EFI` (example):
   ```sh
   gcc -fpic -fshort-wchar -mno-red-zone -DEFI_FUNCTION_WRAPPER \
       -I/usr/include/efi -I/usr/include/efi/x86_64 \
       -c hello.c -o hello.o
   ld -nostdlib -znocombreloc -T /usr/lib/elf_x86_64_efi.lds \
       -shared -Bsymbolic -L/usr/lib64 -lefi -lgnuefi \
       hello.o -o BOOTX64.EFI
   ```
4. Place `BOOTX64.EFI` on a FAT32 USB under `/EFI/BOOT/`.
5. Boot the machine and pick the USB device; the firmware loads your EFI app and prints the message. No internal disks are changed.

**Notes**
- On Secure Boot systems, you may need to enroll your own key or use a signed shim; otherwise the firmware will refuse the unsigned EFI binary.
- Apple Silicon Macs do not execute arbitrary unsigned EFI binaries; this path targets Intel Macs only.

## Option B: GRUB-based text entry on USB
If you prefer GRUB tooling (common on Ubuntu), you can place GRUB on the USB and add a menu entry that just prints text.

1. Install GRUB to the USB (e.g., `/dev/sdX`) in removable mode: `grub-install --target=x86_64-efi --removable --boot-directory=/mnt/usb/boot /dev/sdX`.
2. Create `/mnt/usb/boot/grub/grub.cfg`:
   ```
   set timeout=5
   menuentry "Hello World" {
     echo "Hello World from GRUB on USB"
     echo "Press any key to reboot"
     read
     reboot
   }
   ```
3. Boot from the USB; selecting the menu entry displays the message and never touches internal drives.

## Why we avoid "hooking" host startups
- Windows Boot Manager, GRUB on Ubuntu, and Apple boot flows read boot configuration from the internal disk/firmware. Without modifying those settings or writing to disk, an external USB cannot automatically insert itself into the chain.
- Attempting to transparently interpose code would require altering boot order, boot records, or leveraging firmware vulnerabilities—none of which are portable or advisable for a benign "Hello World" demo.

## Safe customization approach
If you need a first-boot helper, keep all logic inside the removable media and require the user to explicitly boot it. From there you can present a menu to:
- Show diagnostics or branding messages (UEFI app or GRUB `echo`).
- Chainload into an installer or live OS only when chosen.
- Exit to the existing OS by rebooting, leaving internal disks untouched.

This keeps the demo transparent, consent-based, and maintainable across Windows PCs, Ubuntu systems, and Intel Macs.
