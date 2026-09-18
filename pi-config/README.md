# Auto-update with a systemctl task

Copy files to the appropriate directory:
```sh
sudo cp auto-update.sh /usr/bin
sudo cp auto-update.service /etc/systemd/system/
sudo cp auto-update.timer /etc/systemd/system/
```

Enable tasks:
```sh
sudo systemctl daemon-reload
sudo systemctl enable --now auto-update.timer
```
